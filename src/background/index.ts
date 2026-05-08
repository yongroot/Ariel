import type { PanelMessage, StreamEvent } from "../shared/protocol";
import { handleChatSend, abortChat } from "./llm";
import { STORAGE_KEYS, DEFAULT_SETTINGS } from "../shared/constants";
import type { Settings, PageContext, Message } from "../shared/types";
import { handleCapturedRequest, getCapturedCount, getCapturedList, clearCaptured } from "./tools/registry";

// Per-tab theme cache
const tabThemes = new Map<number, { bg: string }>();

// 打开 Side Panel
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// Port 连接（SidePanel ↔ SW 流式通信）
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "chat-stream") return;

  port.onMessage.addListener(async (message: PanelMessage) => {
    if (message.type === "CHAT_SEND") {
      const sendEvent = (event: StreamEvent) => {
        try {
          port.postMessage(event);
        } catch {
          // Port 已断开
        }
      };
      await handleChatSend(message.content, message.history, sendEvent);
    } else if (message.type === "CHAT_ABORT") {
      abortChat();
      port.postMessage({ type: "DONE" } as StreamEvent);
    }
  });
});

// 单次消息路由（非流式操作）
chrome.runtime.onMessage.addListener(
  (message: PanelMessage, _sender, sendResponse) => {
    switch (message.type) {
      case "GET_PAGE_CONTEXT":
        getPageContext()
          .then((ctx) => sendResponse(ctx))
          .catch(() =>
            sendResponse({ title: "", url: "", selectedText: "" })
          );
        return true;

      case "GET_SETTINGS":
        getSettings().then(sendResponse);
        return true;

      case "UPDATE_SETTINGS":
        chrome.storage.local.set({
          [STORAGE_KEYS.SETTINGS]: message.settings,
        });
        sendResponse({ ok: true });
        break;

      case "SAVE_HISTORY":
        chrome.storage.local.set({
          [STORAGE_KEYS.HISTORY]: message.messages,
        });
        sendResponse({ ok: true });
        break;

      case "LOAD_HISTORY":
        chrome.storage.local
          .get(STORAGE_KEYS.HISTORY)
          .then((result) =>
            sendResponse(
              (result[STORAGE_KEYS.HISTORY] as Message[] | undefined) ?? []
            )
          );
        return true;

      case "CLEAR_HISTORY":
        chrome.storage.local.remove(STORAGE_KEYS.HISTORY);
        sendResponse({ ok: true });
        break;

      case "CAPTURED_API":
        handleCapturedRequest({ ...message, tabId: _sender.tab?.id ?? 0 });
        sendResponse({ ok: true });
        break;

      case "GET_CAPTURED_COUNT":
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          sendResponse({ count: getCapturedCount(tabs[0]?.id) });
        });
        return true;

      case "GET_CAPTURED_LIST":
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          sendResponse({ requests: getCapturedList(50, tabs[0]?.id) });
        });
        return true;

      case "CLEAR_CAPTURED":
        clearCaptured();
        sendResponse({ ok: true });
        break;

      case "PAGE_THEME":
        // Cache theme from content script, keyed by sender tab
        if (_sender.tab?.id != null) {
          tabThemes.set(_sender.tab.id, message.theme);
        }
        sendResponse({ ok: true });
        break;

      case "GET_PAGE_THEME":
        // Sidepanel polls for current tab's theme
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs[0]?.id;
          sendResponse(tabId != null ? tabThemes.get(tabId) ?? null : null);
        });
        return true;
    }
  }
);

// Tab 切换时采样新 tab 主题，再通知 SidePanel
chrome.tabs.onActivated.addListener((activeInfo) => {
  // 注入采样函数到新激活的 tab，让 content script 上报 PAGE_THEME 到 SW 缓存
  chrome.scripting.executeScript({
    target: { tabId: activeInfo.tabId },
    func: () => {
      const computedStyle = getComputedStyle(document.documentElement);
      let bg = computedStyle.backgroundColor;
      if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") {
        const bodyStyle = getComputedStyle(document.body);
        bg = bodyStyle.backgroundColor;
      }
      if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") {
        bg = "rgb(255, 255, 255)";
      }
      window.postMessage({ type: "__ARIEL_CAPTURE__", payload: { type: "PAGE_THEME", theme: { bg } } }, "*");
    },
  }).catch(() => {
    // 某些页面（chrome://、about:）无法注入，忽略
  });

  // 等待采样完成后再广播 TAB_ACTIVATED
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: "TAB_ACTIVATED", tabId: activeInfo.tabId }).catch(() => {
      // SidePanel 可能未打开，忽略
    });
  }, 100);
});

async function getPageContext(): Promise<PageContext> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return { title: "", url: "", selectedText: "" };

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        url: location.href,
        selectedText: window.getSelection()?.toString() ?? "",
      }),
    });
    return results?.[0]?.result ?? { title: "", url: "", selectedText: "" };
  } catch {
    return { title: "", url: "", selectedText: "" };
  }
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEYS.SETTINGS] ?? {}),
  } as Settings;
}
