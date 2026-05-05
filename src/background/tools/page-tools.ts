import type { ToolDefinition } from "../../shared/types";

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function sendToContentScript<T>(message: object, fallback?: () => Promise<T>): Promise<T> {
  const tabId = await getActiveTabId();
  if (!tabId) throw new Error("无法获取当前标签页");

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    if (fallback) return fallback();
    throw new Error("无法与页面通信，请刷新页面后重试");
  }
}

async function executeScriptInTab<T>(fn: () => T): Promise<T> {
  const tabId = await getActiveTabId();
  if (!tabId) throw new Error("无法获取当前标签页");
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: fn });
  return results?.[0]?.result as T;
}

// 可见文本提取（与 content/index.ts 同逻辑，用于 fallback）
function extractVisibleText(el: Element): string {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return "";
  if (el.getAttribute("aria-hidden") === "true") return "";
  const skipTags = new Set(["SCRIPT","STYLE","LINK","META","NOSCRIPT","SVG","BR","HR","IMG","INPUT","TEXTAREA","SELECT"]);
  if (skipTags.has(el.tagName)) return "";
  if (el.children.length === 0) return el.textContent?.trim() ?? "";
  const parts: string[] = [];
  for (const child of el.children) {
    const t = extractVisibleText(child);
    if (t) parts.push(t);
  }
  const blockTags = new Set(["DIV","P","H1","H2","H3","H4","H5","H6","LI","TR","TD","TH","BLOCKQUOTE","PRE","SECTION","ARTICLE","HEADER","FOOTER","NAV","MAIN","ASIDE","UL","OL","TABLE","FORM","DETAILS","SUMMARY"]);
  return parts.join(blockTags.has(el.tagName) ? "\n" : " ");
}

export const inspectTool: ToolDefinition = {
  name: "inspect",
  description: "获取当前页面的结构概览。返回页面中的主要区域（header/nav/main/section/footer等）及其属性，用于了解页面布局后精确读取内容。无需参数。",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    return sendToContentScript<string>(
      { type: "INSPECT" },
      () => executeScriptInTab(() => {
        const body = document.body;
        if (!body) return "页面无 body";
        const children = Array.from(body.children);
        const lines: string[] = [`页面: ${document.title} (${location.href})`];
        for (const child of children) {
          const tag = child.tagName.toLowerCase();
          if (["script", "style", "link", "meta", "noscript"].includes(tag)) continue;
          const sel = tag + (child.id ? `#${child.id}` : "");
          const label = child.getAttribute("aria-label") || child.getAttribute("title") || "";
          const interactive = child.querySelectorAll("button,a,input,select,textarea").length;
          const chars = extractVisibleText(child).length;
          lines.push(`${sel}${label ? ` [${label}]` : ""} — 交互:${interactive} 字符:${chars}`);
        }
        return lines.join("\n").slice(0, 2000);
      })
    );
  },
};

export const readTool: ToolDefinition = {
  name: "read",
  description: "精确读取当前页面指定元素的内容。先用 inspect 了解页面结构，再用此工具读取具体区域。支持分页读取大段内容。",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS 选择器，如 'main', 'article', '#content', '.post-body'",
      },
      offset: {
        type: "number",
        description: "起始偏移字符数，默认 0",
      },
      limit: {
        type: "number",
        description: "最大读取字符数，默认 4000",
      },
    },
    required: ["selector"],
  },
  execute: async (args) => {
    const selector = args.selector as string;
    const offset = (args.offset as number) ?? 0;
    const limit = (args.limit as number) ?? 4000;

    return sendToContentScript<{
      content: string;
      totalChars: number;
      hasMore: boolean;
      truncated: boolean;
    }>(
      { type: "READ", selector, offset, limit },
      () => executeScriptInTab(() => {
        const el = document.querySelector(selector ?? "body");
        if (!el) return { content: `未找到元素: ${selector}`, totalChars: 0, hasMore: false, truncated: false };
        const text = extractVisibleText(el);
        const sliced = text.slice(offset ?? 0, (offset ?? 0) + (limit ?? 4000));
        return { content: sliced, totalChars: text.length, hasMore: (offset ?? 0) + (limit ?? 4000) < text.length, truncated: true };
      })
    );
  },
};
