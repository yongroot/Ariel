// Content Script (MAIN world): fetch/XHR 拦截
// 注意：此文件运行在页面的 JS 上下文中，不能使用 chrome.* API
// 通过 window.postMessage 将捕获的数据发给 bridge.ts（ISOLATED world）

function isJsonContentType(contentType: string): boolean {
  return contentType.includes("application/json") || contentType.includes("text/json");
}

function sendToBridge(payload: object) {
  window.postMessage({ type: "__ARIEL_CAPTURE__", payload }, "*");
}

/** 从 RequestInit 中提取 headers 为 Record */
function extractHeadersFromInit(init?: RequestInit): Record<string, string> {
  if (!init?.headers) return {};
  const result: Record<string, string> = {};
  const headers = init.headers;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { result[key] = value; });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      result[key] = value;
    }
  } else if (typeof headers === "object") {
    Object.assign(result, headers);
  }
  return result;
}

/** 从 Response headers 提取为 Record */
function extractResponseHeaders(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  response.headers.forEach((value, key) => { result[key] = value; });
  return result;
}

// === Fetch 拦截 ===
const originalFetch = window.fetch;
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
  const response = await originalFetch.call(this, input, init);
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const contentType = response.headers.get("content-type") || "";
    if (isJsonContentType(contentType)) {
      const clone = response.clone();
      const body = await clone.text();
      sendToBridge({
        type: "CAPTURED_API",
        id: crypto.randomUUID(),
        url,
        method: init?.method || "GET",
        statusCode: response.status,
        contentType,
        responseBody: body,
        requestBody: init?.body?.toString() || undefined,
        requestHeaders: extractHeadersFromInit(init),
        responseHeaders: extractResponseHeaders(response),
        timestamp: Date.now(),
      });
    }
  } catch { /* 忽略 */ }
  return response;
};

// === XHR 拦截 ===
const origXHROpen = XMLHttpRequest.prototype.open;
const origXHRSend = XMLHttpRequest.prototype.send;
const origXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
  (this as any).__agentUrl = String(url);
  (this as any).__agentMethod = method;
  (this as any).__agentHeaders = {} as Record<string, string>;
  return origXHROpen.call(this, method, url, async ?? true, username, password);
};

XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
  const xhr = this as any;
  if (xhr.__agentHeaders) {
    xhr.__agentHeaders[name] = value;
  }
  return origXHRSetRequestHeader.call(this, name, value);
};

XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
  const xhr = this as any;
  xhr.addEventListener("load", () => {
    try {
      const contentType = xhr.getResponseHeader("content-type") || "";
      if (isJsonContentType(contentType)) {
        // 提取 response headers
        const responseHeaders: Record<string, string> = {};
        const headerStr = xhr.getAllResponseHeaders();
        if (headerStr) {
          const pairs = headerStr.trim().split(/\r?\n/);
          for (const pair of pairs) {
            const idx = pair.indexOf(":");
            if (idx > 0) {
              const key = pair.slice(0, idx).trim().toLowerCase();
              const val = pair.slice(idx + 1).trim();
              responseHeaders[key] = val;
            }
          }
        }

        sendToBridge({
          type: "CAPTURED_API",
          id: crypto.randomUUID(),
          url: xhr.__agentUrl,
          method: xhr.__agentMethod,
          statusCode: xhr.status,
          contentType,
          responseBody: xhr.responseText,
          requestBody: body?.toString() || undefined,
          requestHeaders: xhr.__agentHeaders || {},
          responseHeaders,
          timestamp: Date.now(),
        });
      }
    } catch { /* 忽略 */ }
  });
  return origXHRSend.call(this, body);
};
