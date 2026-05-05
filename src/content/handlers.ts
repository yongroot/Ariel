import { isHidden, extractVisibleText, buildSelector, countInteractive } from "./dom-utils";

export function handleInspect(): string {
  const body = document.body;
  if (!body) return "页面无 body";
  const children = Array.from(body.children);
  const lines: string[] = [`页面: ${document.title} (${location.href})`];
  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    if (["script", "style", "link", "meta", "noscript"].includes(tag)) continue;
    const hidden = isHidden(child);
    const selector = buildSelector(child);
    const label = child.getAttribute("aria-label") || child.getAttribute("title") || child.getAttribute("role") || "";
    const interactive = countInteractive(child);
    const chars = extractVisibleText(child).length;
    let line = `${selector}`;
    if (label) line += ` [${label}]`;
    if (hidden) line += ` (hidden)`;
    line += ` — 交互:${interactive} 字符:${chars}`;
    lines.push(line);
  }
  let result = lines.join("\n");
  if (result.length > 2000) {
    result = result.slice(0, 1997) + "...";
  }
  return result;
}

export function handleRead(selector: string, offset = 0, limit = 4000) {
  const el = document.querySelector(selector);
  if (!el) {
    return { content: `未找到元素: ${selector}`, totalChars: 0, hasMore: false, truncated: false };
  }
  const text = extractVisibleText(el);
  const totalChars = text.length;
  const sliced = text.slice(offset, offset + limit);
  const hasMore = offset + limit < totalChars;
  return { content: sliced, totalChars, hasMore, truncated: hasMore };
}

export function extractPageContext() {
  return {
    title: document.title,
    url: location.href,
    selectedText: window.getSelection()?.toString() ?? "",
  };
}
