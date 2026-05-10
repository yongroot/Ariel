export const DEFAULT_SETTINGS = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
} as const;

export const STORAGE_KEYS = {
  SETTINGS: "ariel_settings",
  HISTORY: "ariel_history",
  SESSIONS: "ariel_sessions",
  ACTIVE_SESSION: "ariel_active_session",
  THEME: "ariel_theme",
} as const;

export const MESSAGE_TYPES = {
  CHAT_SEND: "CHAT_SEND",
  CHAT_ABORT: "CHAT_ABORT",
  GET_PAGE_CONTEXT: "GET_PAGE_CONTEXT",
  GET_SETTINGS: "GET_SETTINGS",
  UPDATE_SETTINGS: "UPDATE_SETTINGS",
} as const;
