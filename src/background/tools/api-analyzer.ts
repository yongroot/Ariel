/**
 * 接口分析引擎 — 将 CapturedRequest[] 确定性分析为 ApiRecipe 草稿
 *
 * 纯启发式规则，不依赖 LLM
 */

import type { CapturedRequest, ApiRecipe, ApiParam } from '../../shared/api-knowledge-types';
import { getETLD1 } from '../api-knowledge-store';

// ============================================================
// URL Pattern
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUM_RE = /^\d+$/;
/** 长度 >= 16 且混有字母数字的视为 token */
const TOKEN_RE = /^[a-zA-Z0-9_-]{16,}$/;

function classifySegment(seg: string): { placeholder: string; name: string } {
  if (NUM_RE.test(seg)) return { placeholder: ':id', name: 'id' };
  if (UUID_RE.test(seg)) return { placeholder: ':uuid', name: 'uuid' };
  if (TOKEN_RE.test(seg) && seg.length >= 16) return { placeholder: ':token', name: 'token' };
  return { placeholder: seg, name: seg };
}

interface UrlPattern {
  /** :param 风格模板 */
  template: string;
  /** path 参数名列表，按顺序 */
  paramNames: string[];
}

function toUrlPattern(pathname: string): UrlPattern {
  const segments = pathname.split('/').filter(Boolean);
  const parts: string[] = [];
  const names: string[] = [];
  const nameCount: Record<string, number> = {};

  for (const seg of segments) {
    const { placeholder, name } = classifySegment(seg);
    if (placeholder.startsWith(':')) {
      const base = name;
      const count = nameCount[base] ?? 0;
      nameCount[base] = count + 1;
      const uniqueName = count > 0 ? `${base}${count + 1}` : base;
      parts.push(`:${uniqueName}`);
      names.push(uniqueName);
    } else {
      parts.push(seg);
    }
  }

  return { template: '/' + parts.join('/'), paramNames: names };
}

function patternKey(method: string, pattern: UrlPattern): string {
  return `${method.toUpperCase()} ${pattern.template}`;
}

// ============================================================
// JSON 结构提取
// ============================================================

function tryParseJson(str: string | undefined): unknown {
  if (!str) return undefined;
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

/** 提取顶层 key 列表 */
function topKeys(obj: unknown): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [];
  return Object.keys(obj as Record<string, unknown>);
}

/** 在 JSON 中找到第一个数组，返回其路径 */
function findFirstArrayPath(
  obj: unknown,
  prefix = '',
): { path: string; arr: unknown[] } | null {
  if (Array.isArray(obj)) {
    return { path: prefix || '.', arr: obj };
  }
  if (typeof obj === 'object' && obj !== null) {
    const record = obj as Record<string, unknown>;
    // 优先检查常见 key
    for (const key of ['data', 'items', 'list', 'rows', 'records', 'results']) {
      if (Array.isArray(record[key])) {
        const p = prefix ? `${prefix}.${key}` : key;
        return { path: p, arr: record[key] as unknown[] };
      }
    }
    // 递归一层
    for (const [key, val] of Object.entries(record)) {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        const result = findFirstArrayPath(val, prefix ? `${prefix}.${key}` : key);
        if (result) return result;
      }
    }
  }
  return null;
}

// ============================================================
// 分页检测
// ============================================================

interface PaginationInfo {
  type: 'offset' | 'cursor' | 'page';
  params: string[];
  next_path?: string;
  total_path?: string;
}

const PAGINATION_FIELDS: Record<string, string[]> = {
  page: ['page', 'pageNo', 'pageNum', 'current', 'currentPage'],
  page_size: ['pageSize', 'size', 'perPage', 'limit', 'count'],
  total: ['total', 'totalCount', 'totalItems', 'totalElements', 'totalNum'],
  cursor: ['cursor', 'nextCursor', 'next_cursor', 'after', 'nextPageToken', 'next_token'],
  has_more: ['hasMore', 'has_more', 'hasNextPage', 'isEnd'],
  offset: ['offset', 'skip'],
};

function detectPagination(
  responseObj: unknown,
  dataPath: string,
): PaginationInfo | undefined {
  if (typeof responseObj !== 'object' || responseObj === null) return undefined;

  // 检查与数组同级或上层的字段
  const parent = dataPath.includes('.')
    ? resolveSimplePath(responseObj, dataPath.split('.').slice(0, -1).join('.'))
    : responseObj;

  if (typeof parent !== 'object' || parent === null) return undefined;
  const record = parent as Record<string, unknown>;
  const keys = Object.keys(record).map((k) => k.toLowerCase());

  const hasPage = keys.some((k) => PAGINATION_FIELDS.page.includes(k));
  const hasPageSize = keys.some((k) => PAGINATION_FIELDS.page_size.includes(k));
  const hasCursor = keys.some((k) => PAGINATION_FIELDS.cursor.includes(k));
  const hasOffset = keys.some((k) => PAGINATION_FIELDS.offset.includes(k));
  const hasTotal = keys.some((k) => PAGINATION_FIELDS.total.includes(k));

  if (hasCursor) {
    const actualKey = findActualKey(record, PAGINATION_FIELDS.cursor);
    return {
      type: 'cursor',
      params: ['cursor'],
      next_path: dataPath ? `${dataPath}.${actualKey}` : actualKey,
      ...(hasTotal ? { total_path: findActualKeyPath(record, PAGINATION_FIELDS.total, dataPath) } : {}),
    };
  }

  if (hasPage || hasOffset) {
    const pageKey = findActualKey(record, PAGINATION_FIELDS.page);
    const sizeKey = findActualKey(record, PAGINATION_FIELDS.page_size) ?? findActualKey(record, PAGINATION_FIELDS.offset);
    const params: string[] = [];
    if (pageKey) params.push(pageKey);
    if (sizeKey) params.push(sizeKey);

    return {
      type: hasOffset ? 'offset' : 'page',
      params,
      ...(hasTotal ? { total_path: findActualKeyPath(record, PAGINATION_FIELDS.total, dataPath) } : {}),
    };
  }

  return undefined;
}

function findActualKey(record: Record<string, unknown>, candidates: string[]): string | undefined {
  const lowerMap = new Map(Object.keys(record).map((k) => [k.toLowerCase(), k]));
  for (const c of candidates) {
    const actual = lowerMap.get(c.toLowerCase());
    if (actual !== undefined) return actual;
  }
  return undefined;
}

function findActualKeyPath(record: Record<string, unknown>, candidates: string[], prefix: string): string | undefined {
  const key = findActualKey(record, candidates);
  if (!key) return undefined;
  return prefix ? `${prefix}.${key}` : key;
}

function resolveSimplePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let current = obj;
  for (const key of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ============================================================
// 错误结构检测
// ============================================================

interface ErrorIndicators {
  body_path?: string;
  error_values?: string[];
}

function detectErrorIndicators(responseObj: unknown): ErrorIndicators | undefined {
  if (typeof responseObj !== 'object' || responseObj === null) return undefined;
  const record = responseObj as Record<string, unknown>;

  const codeCandidates = ['code', 'errcode', 'errorCode', 'error_code', 'status', 'ret', 'retCode'];
  for (const key of codeCandidates) {
    if (record[key] !== undefined) {
      const val = record[key];
      // 如果值是 0、200、"0"、"200"、"ok"、"success" 等，说明不是错误结构
      const successValues = [0, 200, '0', '200', 'ok', 'success', 'OK', 'SUCCESS', true, 'true'];
      if (successValues.includes(val as string | number | boolean)) {
        // 这个 code 字段表示成功，取反值表示错误
        const errorVals = detectErrorValues(record, key);
        return {
          body_path: key,
          error_values: errorVals,
        };
      }
      // 值不在成功列表中，可能是错误码
      return {
        body_path: key,
      };
    }
  }

  return undefined;
}

function detectErrorValues(record: Record<string, unknown>, codeKey: string): string[] | undefined {
  // 无法仅从单次请求推断所有错误值，返回 null 表示不限定
  void record;
  void codeKey;
  return undefined;
}

// ============================================================
// Headers 模板提取
// ============================================================

const DYNAMIC_HEADERS = new Set([
  'authorization', 'cookie', 'x-csrf-token', 'x-xsrf-token',
  'x-request-id', 'traceparent', 'tracestate',
  'content-length', 'host', 'origin', 'referer',
  'accept-encoding', 'accept-language', 'connection',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
]);

function extractHeadersTemplate(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (DYNAMIC_HEADERS.has(lower)) continue;
    result[key] = value;
  }
  return result;
}

// ============================================================
// Enum 检测
// ============================================================

/** 如果一个参数在多次请求中取值有限且固定，识别为 enum */
function detectEnum(values: unknown[]): string[] | undefined {
  const unique = new Set(values.map((v) => String(v ?? '')));
  // 去掉空字符串
  unique.delete('');
  if (unique.size >= 2 && unique.size <= 10) {
    return [...unique];
  }
  return undefined;
}

// ============================================================
// 核心分析函数
// ============================================================

export interface ApiRecipeDraft {
  recipe: Omit<ApiRecipe, 'version'>;
  /** 分析过程中收集的统计信息 */
  stats: {
    requestCount: number;
    uniqueUrls: number;
  };
}

export function analyzeRequests(requests: CapturedRequest[]): ApiRecipeDraft[] {
  if (requests.length === 0) return [];

  // 1. 按 URL pattern 分组
  const groups = new Map<string, { pattern: UrlPattern; requests: CapturedRequest[] }>();

  for (const req of requests) {
    let pathname: string;
    let hostname: string;
    try {
      const url = new URL(req.url);
      pathname = url.pathname;
      hostname = url.hostname;
    } catch {
      continue;
    }

    const pattern = toUrlPattern(pathname);
    const key = patternKey(req.method, pattern);

    if (!groups.has(key)) {
      groups.set(key, { pattern, requests: [] });
    }
    groups.get(key)!.requests.push({ ...req, _hostname: hostname } as CapturedRequest & { _hostname: string });
  }

  // 2. 对每组生成 recipe 草稿
  const drafts: ApiRecipeDraft[] = [];

  for (const [key, group] of groups) {
    const { pattern, requests: groupReqs } = group;
    const first = groupReqs[0];
    const method = first.method.toUpperCase();

    // 基本信息
    let site: string;
    try {
      const url = new URL(first.url);
      site = getETLD1(url.hostname);
    } catch {
      continue;
    }

    const id = generateId(site, method, pattern.template);
    const safe = method === 'GET' || method === 'HEAD';
    const isGraphql = isGraphQL(first);

    // URL template（含 query 基础路径）
    let urlTemplate: string;
    try {
      const url = new URL(first.url);
      urlTemplate = `${url.origin}${pattern.template}`;
    } catch {
      urlTemplate = pattern.template;
    }

    // 合并所有请求的 headers
    const mergedHeaders = mergeHeaders(groupReqs.map((r) => r.request_headers));
    const headersTemplate = extractHeadersTemplate(mergedHeaders);

    // 参数提取
    const params = extractParams(groupReqs, pattern);

    // Body template
    const bodyTemplate = extractBodyTemplate(groupReqs, isGraphql);

    // 响应分析
    const responseShape = analyzeResponses(groupReqs);

    // 生成名称和描述
    const segments = pattern.template.split('/').filter((s) => !s.startsWith(':') && s.length > 0);
    const lastSeg = segments[segments.length - 1] || 'root';
    const name = generateName(method, lastSeg, segments);
    const description = generateDescription(method, lastSeg, segments, pattern.paramNames);
    const limitations = generateLimitations(safe, method, isGraphql);

    const recipe: Omit<ApiRecipe, 'version'> = {
      id,
      site,
      name,
      description,
      limitations,
      protocol: isGraphql ? 'graphql' : 'rest',
      safe,
      requires_confirmation: !safe,
      request: {
        method,
        url_template: urlTemplate,
        headers_template: headersTemplate,
        ...(bodyTemplate ? { body_template: bodyTemplate } : {}),
        content_type: method !== 'GET' && method !== 'HEAD' ? 'json' : undefined,
      },
      params,
      response_shape: responseShape,
      captured_at: Date.now(),
      last_used: Date.now(),
      use_count: 0,
      verified: false,
      reliability: 1.0,
    };

    drafts.push({
      recipe,
      stats: {
        requestCount: groupReqs.length,
        uniqueUrls: new Set(groupReqs.map((r) => r.url)).size,
      },
    });
  }

  return drafts;
}

// ============================================================
// 辅助函数
// ============================================================

function isGraphQL(req: CapturedRequest): boolean {
  const urlLower = req.url.toLowerCase();
  if (urlLower.includes('graphql')) return true;
  const body = tryParseJson(req.request_body);
  if (body && typeof body === 'object' && 'query' in (body as Record<string, unknown>)) return true;
  return false;
}

function generateId(site: string, method: string, template: string): string {
  // 简单 hash
  const raw = `${site}:${method}:${template}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `recipe_${Math.abs(hash).toString(36)}`;
}

function mergeHeaders(headersList: Record<string, string>[]): Record<string, string> {
  const result: Record<string, string> = {};
  const count: Record<string, number> = {};
  const total = headersList.length;

  for (const headers of headersList) {
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (!result[lower]) {
        result[lower] = value;
        count[lower] = 1;
      } else if (result[lower] === value) {
        count[lower]++;
      }
    }
  }

  // 只保留在 >= 50% 请求中都出现的 headers
  const threshold = Math.ceil(total * 0.5);
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(result)) {
    if ((count[key] ?? 0) >= threshold) {
      // 恢复原始大小写（从最后一次出现的 headers 中获取）
      for (const h of headersList) {
        for (const [origKey, origVal] of Object.entries(h)) {
          if (origKey.toLowerCase() === key && origVal === value) {
            filtered[origKey] = value;
            break;
          }
        }
      }
    }
  }

  return filtered;
}

function extractParams(
  requests: CapturedRequest[],
  pattern: UrlPattern,
): ApiParam[] {
  const params: ApiParam[] = [];

  // Path 参数
  pattern.paramNames.forEach((name, order) => {
    params.push({
      name,
      type: 'path',
      required: true,
      description: `路径参数 ${name}`,
      order,
    });
  });

  // Query 参数 — 收集所有出现过的
  const queryParams = collectQueryParams(requests);
  for (const [name, values] of queryParams) {
    const enumVals = detectEnum(values);
    params.push({
      name,
      type: 'query',
      required: false,
      description: `查询参数 ${name}`,
      ...(enumVals ? { enum: enumVals } : {}),
    });
  }

  // Body 参数
  if (requests[0].request_body && requests[0].method.toUpperCase() !== 'GET') {
    const bodyParams = collectBodyParams(requests);
    for (const [name, info] of bodyParams) {
      params.push({
        name,
        type: 'body',
        required: info.required,
        description: `请求体参数 ${name}`,
        ...(info.enum ? { enum: info.enum } : {}),
      });
    }
  }

  return params;
}

function collectQueryParams(requests: CapturedRequest[]): Map<string, unknown[]> {
  const paramMap = new Map<string, unknown[]>();

  for (const req of requests) {
    try {
      const url = new URL(req.url);
      for (const [key, value] of url.searchParams) {
        if (!paramMap.has(key)) paramMap.set(key, []);
        paramMap.get(key)!.push(value);
      }
    } catch {
      continue;
    }
  }

  return paramMap;
}

interface BodyParamInfo {
  required: boolean;
  enum?: string[];
}

function collectBodyParams(requests: CapturedRequest[]): Map<string, BodyParamInfo> {
  const paramMap = new Map<string, BodyParamInfo & { values: unknown[] }>();

  for (const req of requests) {
    const body = tryParseJson(req.request_body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) continue;

    const record = body as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (!paramMap.has(key)) {
        paramMap.set(key, { required: true, values: [] });
      }
      const entry = paramMap.get(key)!;
      entry.values.push(value);

      // 如果某次请求缺少该字段，则标记为非必填
      // （这里简化处理：只要不是所有请求都有就标记非必填）
    }
  }

  // 检查必填性
  const total = requests.filter((r) => tryParseJson(r.request_body)).length;
  const result = new Map<string, BodyParamInfo>();
  for (const [key, info] of paramMap) {
    const enumVals = detectEnum(info.values);
    result.set(key, {
      required: info.values.length >= total * 0.8,
      ...(enumVals ? { enum: enumVals } : {}),
    });
  }

  return result;
}

function extractBodyTemplate(
  requests: CapturedRequest[],
  isGraphql: boolean,
): ApiRecipe['request']['body_template'] {
  const body = tryParseJson(requests[0]?.request_body);
  if (!body) return undefined;

  if (isGraphql && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const query = typeof record.query === 'string' ? record.query : '';
    const variables = record.variables && typeof record.variables === 'object'
      ? Object.fromEntries(
          Object.keys(record.variables as Record<string, unknown>).map((k) => [k, `{${k}}`]),
        )
      : {};
    return { query, variables_template: variables };
  }

  // REST: 用占位符替换值
  if (typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const template: Record<string, string> = {};
    for (const key of Object.keys(record)) {
      template[key] = `{${key}}`;
    }
    return JSON.stringify(template);
  }

  return undefined;
}

function analyzeResponses(requests: CapturedRequest[]): ApiRecipe['response_shape'] {
  // 取最近一次成功的响应做分析
  const successReq = [...requests]
    .reverse()
    .find((r) => r.response_status >= 200 && r.response_status < 300);

  const sampleBody = tryParseJson(successReq?.response_body);

  let dataPath = '';
  let description = '响应数据';
  let pagination: ApiRecipe['response_shape']['pagination'];
  let errorIndicators: ApiRecipe['response_shape']['error_indicators'];

  if (sampleBody && typeof sampleBody === 'object') {
    const found = findFirstArrayPath(sampleBody);
    if (found) {
      dataPath = found.path;
      const arrLen = found.arr.length;
      if (arrLen > 0 && typeof found.arr[0] === 'object' && found.arr[0] !== null) {
        const fields = Object.keys(found.arr[0] as Record<string, unknown>);
        description = `包含 ${arrLen} 条记录的数据列表，字段: ${fields.slice(0, 8).join(', ')}${fields.length > 8 ? '...' : ''}`;
      } else {
        description = `包含 ${arrLen} 个元素的数组`;
      }
      pagination = detectPagination(sampleBody, dataPath);
    }

    const errInfo = detectErrorIndicators(sampleBody);
    if (errInfo) {
      errorIndicators = errInfo;
    }
  }

  return {
    description,
    data_path: dataPath,
    ...(pagination ? { pagination } : {}),
    ...(errorIndicators ? { error_indicators: errorIndicators } : {}),
  };
}

function generateName(method: string, lastSeg: string, segments: string[]): string {
  const actionMap: Record<string, string> = {
    GET: '获取',
    POST: '创建',
    PUT: '更新',
    PATCH: '修改',
    DELETE: '删除',
    HEAD: '检查',
  };
  const action = actionMap[method] || method;

  // 从路径推测资源名
  const resourceSegs = segments.filter(
    (s) => !['api', 'v1', 'v2', 'v3', 'rest', 'web', 'app'].includes(s.toLowerCase()),
  );
  const resource = resourceSegs.length > 0 ? resourceSegs.join('-') : lastSeg;

  return `${action} ${resource}`;
}

function generateDescription(
  method: string,
  lastSeg: string,
  segments: string[],
  paramNames: string[],
): string {
  const actionMap: Record<string, string> = {
    GET: '获取',
    POST: '创建',
    PUT: '全量更新',
    PATCH: '部分更新',
    DELETE: '删除',
    HEAD: '检查',
  };
  const action = actionMap[method] || method;

  const resourceSegs = segments.filter(
    (s) => !['api', 'v1', 'v2', 'v3', 'rest', 'web', 'app'].includes(s.toLowerCase()),
  );
  const resource = resourceSegs.length > 0 ? resourceSegs.join('/') : '资源';

  let desc = `${action} ${resource}`;
  if (paramNames.length > 0) {
    desc += `，通过 ${paramNames.join('/')} 指定具体对象`;
  }
  return desc;
}

function generateLimitations(safe: boolean, method: string, isGraphql: boolean): string {
  const parts: string[] = [];
  if (!safe) {
    parts.push(`${method} 为写操作，调用前需用户确认`);
  }
  if (isGraphql) {
    parts.push('GraphQL 接口，query 语句可能因服务端 schema 变更而失效');
  }
  parts.push('基于有限样本自动分析生成，可能不完整');
  return parts.join('；');
}
