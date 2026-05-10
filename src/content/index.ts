// Content Script (MAIN world): fetch/XHR 拦截
// 注意：此文件运行在页面的 JS 上下文中，不能使用 chrome.* API
// 通过 window.postMessage 将捕获的数据发给 bridge.ts（ISOLATED world）

function isJsonContentType(contentType: string): boolean {
  return contentType.includes("application/json") || contentType.includes("text/json");
}

function sendToBridge(payload: object) {
  window.postMessage({ type: "__ARIEL_CAPTURE__", payload }, "*");
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
        timestamp: Date.now(),
      });
    }
  } catch { /* 忽略 */ }
  return response;
};

// === XHR 拦截 ===
const origXHROpen = XMLHttpRequest.prototype.open;
const origXHRSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
  (this as any).__agentUrl = String(url);
  (this as any).__agentMethod = method;
  return origXHROpen.call(this, method, url, async ?? true, username, password);
};

XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
  const xhr = this as any;
  xhr.addEventListener("load", () => {
    try {
      const contentType = xhr.getResponseHeader("content-type") || "";
      if (isJsonContentType(contentType)) {
        sendToBridge({
          type: "CAPTURED_API",
          id: crypto.randomUUID(),
          url: xhr.__agentUrl,
          method: xhr.__agentMethod,
          statusCode: xhr.status,
          contentType,
          responseBody: xhr.responseText,
          requestBody: body?.toString() || undefined,
          timestamp: Date.now(),
        });
      }
    } catch { /* 忽略 */ }
  });
  return origXHRSend.call(this, body);
};
