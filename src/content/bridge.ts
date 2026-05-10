// Bridge (ISOLATED world):
// 1. 接收 MAIN world 的 postMessage → 转发给 SW
// 2. 处理 inspect/read/page-context（需要 chrome.* API）

import { handleInspect, handleRead, extractPageContext } from "./handlers";

// 1. MAIN world → SW 桥接
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const type = event.data?.type;
  if (type !== "__ARIEL_CAPTURE__") return;

  try {
    chrome.runtime.sendMessage(event.data.payload ?? event.data);
  } catch {
    // SW 未就绪
  }
});

// 2. SW → Content Script 消息（inspect/read/page-context）
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_PAGE_CONTEXT") {
    sendResponse(extractPageContext());
  } else if (message.type === "INSPECT") {
    sendResponse(handleInspect());
  } else if (message.type === "READ") {
    const { selector, offset, limit } = message;
    sendResponse(handleRead(selector, offset, limit));
  }
});
