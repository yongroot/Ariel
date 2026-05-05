import type { Settings, Message } from "./types";

// SidePanel → Service Worker
export type PanelMessage =
  | { type: "CHAT_SEND"; content: string; history: Message[] }
  | { type: "CHAT_ABORT" }
  | { type: "GET_PAGE_CONTEXT" }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; settings: Settings }
  | { type: "SAVE_HISTORY"; messages: Message[] }
  | { type: "LOAD_HISTORY" }
  | { type: "CLEAR_HISTORY" }
  | { type: "GET_CAPTURED_COUNT" }
  | { type: "GET_CAPTURED_LIST" }
  // Content Script → SW: 推送捕获的 API 请求
  | { type: "CAPTURED_API"; id: string; url: string; method: string; statusCode: number; contentType: string; responseBody?: string; requestBody?: string; timestamp: number };

// Service Worker → SidePanel (流式)
export type StreamEvent =
  | { type: "REASONING_DELTA"; content: string }        // 思考过程增量（reasoning_content）
  | { type: "TEXT_DELTA"; content: string }             // 文本增量
  | { type: "TOOL_CALL"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "TOOL_RESULT"; id: string; tool: string; result: unknown; error?: string }
  | { type: "DONE" }
  | { type: "ERROR"; message: string };

// Content Script 响应
export interface PageContextResponse {
  title: string;
  url: string;
  selectedText: string;
}
