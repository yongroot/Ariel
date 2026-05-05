import type { StreamEvent } from "../shared/protocol";
import type { Message } from "../shared/types";
import { getSettings } from "./index";
import { executeTool, getToolDefinitions } from "./tools/registry";
import type { ToolCall } from "../shared/types";

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChoice {
  delta: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason: string | null;
}

// 内部 API 消息格式
type ApiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// 模块级 AbortController
let abortController: AbortController | null = null;

export function abortChat() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}

function messagesToApiMessages(messages: Message[]): ApiMessage[] {
  const result: ApiMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const tool_calls: OpenAIToolCall[] = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
        result.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls,
        });
        if (msg.toolResults) {
          for (const tr of msg.toolResults) {
            const content =
              typeof tr.result === "string"
                ? tr.result
                : JSON.stringify(tr.result ?? (tr.error ?? ""));
            result.push({
              role: "tool",
              tool_call_id: tr.toolCallId,
              content: tr.error ? `Error: ${tr.error}` : content,
            });
          }
        }
      } else {
        result.push({ role: "assistant", content: msg.content });
      }
    }
  }
  return result;
}

export async function handleChatSend(
  content: string,
  history: Message[],
  sendEvent: (event: StreamEvent) => void
) {
  try {
    abortController = new AbortController();

    const settings = await getSettings();
    if (!settings.apiKey) {
      sendEvent({ type: "ERROR", message: "请先在设置中配置 API Key" });
      sendEvent({ type: "DONE" });
      return;
    }

    const apiMessages: ApiMessage[] = [
      ...messagesToApiMessages(history),
      { role: "user", content },
    ];

    await streamChat(apiMessages, settings, sendEvent, abortController.signal);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const message = err instanceof Error ? err.message : "未知错误";
    sendEvent({ type: "ERROR", message });
    sendEvent({ type: "DONE" });
  } finally {
    abortController = null;
  }
}

async function streamChat(
  apiMessages: ApiMessage[],
  settings: { apiKey: string; baseUrl: string; model: string },
  sendEvent: (event: StreamEvent) => void,
  signal: AbortSignal
) {
  const tools = getToolDefinitions();
  const MAX_ROUNDS = 10;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal.aborted) return;

    const result = await singlePass(
      apiMessages,
      settings,
      tools,
      sendEvent,
      signal
    );

    if (signal.aborted) return;
    if (!result.needsToolCall) break;

    // 执行工具并追加结果消息
    for (const tc of result.toolCalls) {
      if (signal.aborted) return;
      try {
        const toolResult = await executeTool(tc.name, tc.args);
        const content =
          typeof toolResult === "string"
            ? toolResult
            : JSON.stringify(toolResult);
        sendEvent({
          type: "TOOL_RESULT",
          id: tc.id,
          tool: tc.name,
          result: toolResult,
        });
        apiMessages.push({ role: "tool", tool_call_id: tc.id, content });
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "工具执行失败";
        sendEvent({
          type: "TOOL_RESULT",
          id: tc.id,
          tool: tc.name,
          result: null,
          error: errorMsg,
        });
        apiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: ${errorMsg}`,
        });
      }
    }
  }

  if (!signal.aborted) {
    sendEvent({ type: "DONE" });
  }
}

interface SinglePassResult {
  needsToolCall: boolean;
  toolCalls: ToolCall[];
}

async function singlePass(
  apiMessages: ApiMessage[],
  settings: { apiKey: string; baseUrl: string; model: string },
  tools: ReturnType<typeof getToolDefinitions>,
  sendEvent: (event: StreamEvent) => void,
  signal: AbortSignal
): Promise<SinglePassResult> {
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: apiMessages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取响应流");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  const pendingToolCalls = new Map<number, ToolCall>();
  let finishReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const json = JSON.parse(trimmed.slice(6));
        const choice = json.choices?.[0] as OpenAIChoice | undefined;
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.reasoning_content) {
          sendEvent({
            type: "REASONING_DELTA",
            content: delta.reasoning_content,
          });
        }

        if (delta.content) {
          fullContent += delta.content;
          sendEvent({ type: "TEXT_DELTA", content: delta.content });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = pendingToolCalls.get(tc.index);
            const id = tc.id ?? existing?.id ?? crypto.randomUUID();
            const name = tc.function?.name ?? existing?.name ?? "";
            const argsStr =
              tc.function?.arguments ??
              (existing?.args ? JSON.stringify(existing.args) : "");

            let parsedArgs: Record<string, unknown>;
            try {
              parsedArgs = JSON.parse(argsStr || "{}");
            } catch {
              parsedArgs = existing?.args ?? {};
            }

            pendingToolCalls.set(tc.index, {
              id,
              name,
              args: parsedArgs,
            });

            if (tc.id) {
              sendEvent({
                type: "TOOL_CALL",
                id,
                tool: name,
                args: parsedArgs,
              });
            }
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      } catch {
        // 忽略解析错误的行
      }
    }
  }

  // 需要工具调用
  if (finishReason === "tool_calls" && pendingToolCalls.size > 0) {
    const toolCalls = Array.from(pendingToolCalls.values());

    const assistantToolCalls: OpenAIToolCall[] = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
    }));
    apiMessages.push({
      role: "assistant",
      content: fullContent || null,
      tool_calls: assistantToolCalls,
    });

    return { needsToolCall: true, toolCalls };
  }

  // 正常结束
  if (fullContent) {
    apiMessages.push({ role: "assistant", content: fullContent });
  }

  return { needsToolCall: false, toolCalls: [] };
}
