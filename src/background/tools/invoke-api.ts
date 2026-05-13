/**
 * Ariel 接口知识库 — invoke_api 工具
 *
 * 在用户 tab 中执行知识库中的 API 调用，继承页面 cookie 认证。
 * 支持写操作确认、GraphQL、CSRF。
 */

import type { ToolDefinition } from '../../shared/types';
import type { ApiRecipe, SiteAuth, InvokeApiResult } from '../../shared/api-knowledge-types';
import { getRecipe, getSiteAuth, updateRecipeStats } from '../api-knowledge-store';

// ============================================================
// 限流器：同站点并发 3，间隔 200ms
// ============================================================

const siteQueues = new Map<string, { count: number; lastRequest: number; waiting: (() => void)[] }>();
const MAX_CONCURRENT = 3;
const MIN_INTERVAL = 200;

async function acquireSite(site: string): Promise<void> {
  let q = siteQueues.get(site);
  if (!q) {
    q = { count: 0, lastRequest: 0, waiting: [] };
    siteQueues.set(site, q);
  }

  if (q.count >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => q!.waiting.push(resolve));
  }

  const wait = MIN_INTERVAL - (Date.now() - q.lastRequest);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }

  q.count++;
  q.lastRequest = Date.now();
}

function releaseSite(site: string): void {
  const q = siteQueues.get(site);
  if (!q) return;
  q.count--;
  if (q.waiting.length > 0) {
    q.waiting.shift()!();
  } else if (q.count <= 0) {
    siteQueues.delete(site);
  }
}

// ============================================================
// 模板替换
// ============================================================

function buildUrl(recipe: ApiRecipe, params: Record<string, string>): string {
  let url = recipe.request.url_template;

  // Path params: :param → value
  for (const p of recipe.params.filter((p) => p.type === 'path')) {
    const value = params[p.name] ?? p.default ?? '';
    url = url.replace(`:${p.name}`, encodeURIComponent(value));
  }

  // Query params
  const queryParams = recipe.params.filter((p) => p.type === 'query');
  if (queryParams.length > 0) {
    const sp = new URLSearchParams();
    for (const p of queryParams) {
      const value = params[p.name] ?? p.default;
      if (value) sp.append(p.name, value);
    }
    const qs = sp.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  return url;
}

function buildHeaders(
  recipe: ApiRecipe,
  siteAuth: SiteAuth | null,
  params: Record<string, string>,
  csrfToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = { ...recipe.request.headers_template };

  // Header params
  for (const p of recipe.params.filter((p) => p.type === 'header')) {
    const value = params[p.name] ?? p.default;
    if (value) headers[p.name] = value;
  }

  // Site auth headers
  if (siteAuth?.headers) {
    Object.assign(headers, siteAuth.headers);
  }

  // CSRF → header
  if (csrfToken && siteAuth?.csrf?.inject_to === 'header') {
    headers[siteAuth.csrf.inject_key] = csrfToken;
  }

  // Content-Type
  if (recipe.request.content_type === 'form-urlencoded') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (recipe.request.body_template && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function buildBody(
  recipe: ApiRecipe,
  params: Record<string, string>,
  siteAuth: SiteAuth | null,
  csrfToken?: string,
): string | undefined {
  const template = recipe.request.body_template;
  if (!template) return undefined;

  if (recipe.protocol === 'graphql' && typeof template === 'object') {
    const variables: Record<string, unknown> = {};
    for (const [key, tmpl] of Object.entries(template.variables_template)) {
      variables[key] = replacePlaceholders(tmpl, params);
    }
    return JSON.stringify({ query: template.query, variables });
  }

  if (typeof template === 'string') {
    let body = replacePlaceholders(template, params);

    // CSRF → body
    if (csrfToken && siteAuth?.csrf?.inject_to === 'body') {
      try {
        const parsed = JSON.parse(body);
        parsed[siteAuth.csrf.inject_key] = csrfToken;
        body = JSON.stringify(parsed);
      } catch {
        // not JSON, append as form field
      }
    }

    return body;
  }

  return undefined;
}

function replacePlaceholders(template: string, params: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

// ============================================================
// 数据提取 & 错误检测
// ============================================================

function extractByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(key, 10);
      if (!isNaN(idx) && idx >= 0 && idx < current.length) {
        current = current[idx];
      } else {
        return undefined;
      }
    } else {
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

function detectError(
  status: number,
  body: unknown,
  indicators?: ApiRecipe['response_shape']['error_indicators'],
): string | null {
  const range = indicators?.http_status_range ?? [200, 299];
  if (status < range[0] || status > range[1]) {
    return `HTTP ${status} 不在正常范围 [${range[0]}, ${range[1]}]`;
  }

  if (indicators?.body_path && indicators.error_values?.length) {
    const value = extractByPath(body, indicators.body_path);
    if (value != null && indicators.error_values.includes(String(value))) {
      return `响应错误码: ${value}`;
    }
  }

  return null;
}

// ============================================================
// CSRF token 获取
// ============================================================

async function getCsrfToken(
  tabId: number,
  csrf: NonNullable<SiteAuth['csrf']>,
): Promise<string | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (source: NonNullable<SiteAuth['csrf']>['token_source']) => {
      switch (source.type) {
        case 'meta_tag': {
          const meta = document.querySelector(`meta[name="${source.key}"]`) as HTMLMetaElement | null;
          return meta?.content ?? null;
        }
        case 'cookie': {
          const match = document.cookie
            .split(';')
            .find((c) => c.trim().startsWith(source.key + '='));
          return match ? match.split('=').slice(1).join('=').trim() : null;
        }
        default:
          return null;
      }
    },
    args: [csrf.token_source],
  });
  return results?.[0]?.result ?? null;
}

// ============================================================
// Tab 内执行 fetch
// ============================================================

async function fetchInTab(
  tabId: number,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; body: unknown }> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (fetchUrl: string, fetchInit: RequestInit) => {
      try {
        const resp = await fetch(fetchUrl, fetchInit);
        const text = await resp.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
        return { status: resp.status, body };
      } catch (err) {
        return { status: 0, body: null, error: String(err) };
      }
    },
    args: [
      url,
      {
        method: init.method,
        headers: init.headers,
        body: init.body ?? null,
      } as RequestInit,
    ],
  });

  const r = results?.[0]?.result as
    | { status: number; body: unknown; error?: string }
    | undefined;
  if (!r) throw new Error('无法在页面中执行请求');
  if (r.error) throw new Error(r.error);
  return { status: r.status, body: r.body };
}

// ============================================================
// Tool Definition
// ============================================================

export const invokeApiTool: ToolDefinition = {
  name: 'invoke_api',
  description:
    '调用知识库中已掌握的 API 接口，获取实时数据或执行操作。' +
    '请求在用户当前页面标签中执行，自动继承页面 cookie 认证。' +
    '写操作（POST/PUT/DELETE）需要用户确认后才会执行。\n\n' +
    '调用接口后，在回答用户时请在末尾标注数据来源。格式：\n' +
    '> 数据来源：{recipe name} ({actual_url})，查询时间：{当前时间}\n\n' +
    '如果接口调用失败（401/403），请提示用户："接口认证可能已失效，请刷新页面后重试。如果问题持续，请重新登录系统。"',
  parameters: {
    type: 'object',
    properties: {
      recipe_id: {
        type: 'string',
        description: '要调用的接口 ID（来自知识库 recipe）',
      },
      params: {
        type: 'object',
        description: '接口参数，key 为参数名，value 为参数值',
        additionalProperties: { type: 'string' },
      },
      confirmed: {
        type: 'boolean',
        description:
          '写操作需要用户确认。首次调用不传或传 false，确认后传 true 再次调用。',
      },
    },
    required: ['recipe_id', 'params'],
  },
  execute: async (args) => {
    const recipeId = args.recipe_id as string;
    const params = ((args.params as Record<string, string>) ?? {});
    const confirmed = args.confirmed as boolean | undefined;

    // 1. Load recipe
    const recipe = await getRecipe(recipeId);
    if (!recipe) {
      return {
        success: false,
        error: `未找到接口知识: ${recipeId}`,
        recipe_id: recipeId,
        actual_url: '',
        status: 0,
      } satisfies InvokeApiResult;
    }

    // 2. 写操作确认
    if (!recipe.safe && confirmed !== true) {
      return {
        success: false,
        needs_confirmation: true,
        recipe_id: recipeId,
        actual_url: '',
        status: 0,
        error: `此接口为写操作 (${recipe.request.method})，需要用户确认`,
        data: {
          name: recipe.name,
          description: recipe.description,
          method: recipe.request.method,
          url_template: recipe.request.url_template,
          params,
          limitations: recipe.limitations,
        },
      } satisfies InvokeApiResult;
    }

    // 3. 校验必填参数
    const missing = recipe.params
      .filter((p) => p.required && !params[p.name] && !p.default)
      .map((p) => p.name);
    if (missing.length > 0) {
      return {
        success: false,
        error: `缺少必填参数: ${missing.join(', ')}`,
        recipe_id: recipeId,
        actual_url: '',
        status: 0,
      } satisfies InvokeApiResult;
    }

    // 4. 获取活跃 tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return {
        success: false,
        error: '未找到活跃标签页',
        recipe_id: recipeId,
        actual_url: '',
        status: 0,
      } satisfies InvokeApiResult;
    }

    // 5. Load site auth
    const siteAuth = await getSiteAuth(recipe.site);

    // 6. 限流
    await acquireSite(recipe.site);
    try {
      // 7. CSRF
      let csrfToken: string | undefined;
      if (siteAuth?.csrf) {
        csrfToken = (await getCsrfToken(tab.id, siteAuth.csrf)) ?? undefined;
      }

      // 8. 构建请求
      const url = buildUrl(recipe, params);
      const headers = buildHeaders(recipe, siteAuth, params, csrfToken);
      const body = buildBody(recipe, params, siteAuth, csrfToken);

      // 9. 执行
      const response = await fetchInTab(tab.id, url, {
        method: recipe.request.method,
        headers,
        body,
      });

      // 10. 错误检测
      const errorMsg = detectError(
        response.status,
        response.body,
        recipe.response_shape.error_indicators,
      );

      // 11. 数据提取
      const data = extractByPath(response.body, recipe.response_shape.data_path);

      // 12. 更新统计
      const success = !errorMsg;
      await updateRecipeStats(recipeId, success);

      return {
        success,
        data: success ? data : undefined,
        error: errorMsg ?? undefined,
        recipe_id: recipeId,
        recipe_name: recipe.name,
        actual_url: url,
        status: response.status,
      } satisfies InvokeApiResult;
    } finally {
      releaseSite(recipe.site);
    }
  },
};
