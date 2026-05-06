import type { ToolDefinition } from "../../shared/types";

// 内存请求存储
interface CapturedRequest {
  id: string;
  url: string;
  method: string;
  statusCode: number;
  contentType: string;
  responseBody?: string;
  requestBody?: string;
  timestamp: number;
}

const store = new Map<string, CapturedRequest>();
const MAX_ENTRIES = 200;

function addEntry(entry: CapturedRequest) {
  store.set(entry.id, entry);
  // 淘汰最旧的
  if (store.size > MAX_ENTRIES) {
    const sorted = Array.from(store.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < sorted.length - MAX_ENTRIES; i++) {
      store.delete(sorted[i][0]);
    }
  }
}

// Content Script 把捕获的请求推送到 SW
// 通过 chrome.runtime.onMessage 接收
export function handleCapturedRequest(entry: CapturedRequest) {
  addEntry(entry);
}

// 查询接口（供 SW 消息处理和调试面板使用）
export function getCapturedCount(): number {
  return store.size;
}

export function getCapturedList(limit = 30): CapturedRequest[] {
  return Array.from(store.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function clearCaptured(): void {
  store.clear();
}

function query(filter: { url?: string; method?: string }, limit = 20): CapturedRequest[] {
  let results = Array.from(store.values());

  if (filter.url) {
    const lowerUrl = filter.url.toLowerCase();
    results = results.filter((r) => r.url.toLowerCase().includes(lowerUrl));
  }
  if (filter.method) {
    results = results.filter((r) => r.method.toUpperCase() === filter.method!.toUpperCase());
  }

  results.sort((a, b) => b.timestamp - a.timestamp);
  return results.slice(0, limit);
}

/**
 * 获取最近匹配的完整响应体（不截断）
 * 供 analyze_data 工具使用
 */
export function getLatestResponseBody(urlKeyword: string): { url: string; responseBody: string | undefined } | null {
  const lowerUrl = urlKeyword.toLowerCase();
  let latest: CapturedRequest | null = null;
  for (const entry of store.values()) {
    if (entry.url.toLowerCase().includes(lowerUrl) && entry.responseBody) {
      if (!latest || entry.timestamp > latest.timestamp) {
        latest = entry;
      }
    }
  }
  if (!latest) return null;
  return { url: latest.url, responseBody: latest.responseBody };
}

export const capturedApiTool: ToolDefinition = {
  name: "captured_api",
  description:
    "查询页面捕获的 API 网络请求数据。可以查看页面加载后发出的所有 XHR/fetch 请求及其响应体。" +
    "当需要获取列表数据、表单提交结果等后端数据时使用此工具。" +
    "注意：只捕获 JSON 响应，不捕获静态资源。",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL 过滤关键词（模糊匹配），不传则返回全部",
      },
      method: {
        type: "string",
        description: "HTTP 方法过滤，如 GET、POST",
      },
      limit: {
        type: "number",
        description: "返回数量限制，默认 20",
      },
    },
  },
  execute: async (args) => {
    const filter: { url?: string; method?: string } = {};
    if (args.url) filter.url = args.url as string;
    if (args.method) filter.method = args.method as string;
    const limit = (args.limit as number) ?? 20;

    const results = query(filter, limit);
    if (results.length === 0) {
      return { count: 0, message: "没有捕获到匹配的请求", requests: [] };
    }

    return {
      count: results.length,
      requests: results.map((r) => ({
        url: r.url,
        method: r.method,
        status: r.statusCode,
        contentType: r.contentType,
        // 响应体可能很大，截断到 2000 字符
        responseBody: r.responseBody
          ? r.responseBody.length > 2000
            ? r.responseBody.slice(0, 2000) + "...(截断，共" + r.responseBody.length + "字符)"
            : r.responseBody
          : undefined,
        requestBody: r.requestBody,
        timestamp: r.timestamp,
      })),
    };
  },
};
