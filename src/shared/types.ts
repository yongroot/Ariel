export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  error?: string;
}

export interface PageContext {
  title: string;
  url: string;
  selectedText: string;
}

export interface Settings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  starred: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};
