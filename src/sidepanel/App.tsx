import { useState, useEffect, useCallback } from "react";
import ChatPanel from "./components/ChatPanel";
import type { Settings } from "../shared/types";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../shared/constants";
import { applyPalette, getPalette, type ThemeMode } from "../shared/theme";

declare const __BUILD_TIME__: number;

const BUILD_TIME = typeof __BUILD_TIME__ === "number"
  ? new Date(__BUILD_TIME__)
  : new Date();

function ThemeToggle({ mode, onToggle }: { mode: ThemeMode; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="relative flex items-center rounded-full p-0.5 transition-colors"
      style={{ width: 48, height: 24, backgroundColor: "var(--ap-bg-tertiary)" }}
      title={mode === "light" ? "切换深色模式" : "切换浅色模式"}
    >
      <span
        className="flex items-center justify-center rounded-full transition-transform duration-300"
        style={{
          width: 20,
          height: 20,
          backgroundColor: "var(--ap-accent)",
          transform: mode === "dark" ? "translateX(24px)" : "translateX(0)",
        }}
      />
      {/* Sun icon */}
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="absolute left-[6px]"
        style={{ color: "var(--ap-text-muted)" }}
      >
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
      {/* Moon icon */}
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="absolute right-[6px]"
        style={{ color: "var(--ap-text-muted)" }}
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}

function App() {
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [showHistory, setShowHistory] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [newSessionSignal, setNewSessionSignal] = useState(0);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");

  // Apply palette on mount + whenever themeMode changes
  useEffect(() => {
    applyPalette(document.documentElement, getPalette(themeMode));
  }, [themeMode]);

  // Load persisted theme on mount
  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.THEME, (result) => {
      const stored = result[STORAGE_KEYS.THEME] as ThemeMode | undefined;
      if (stored === "light" || stored === "dark") {
        setThemeMode(stored);
      }
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeMode((prev) => {
      const next = prev === "light" ? "dark" : "light";
      chrome.storage.local.set({ [STORAGE_KEYS.THEME]: next });
      return next;
    });
  }, []);

  const loadSettings = async () => {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    setSettings({
      ...DEFAULT_SETTINGS,
      ...(result[STORAGE_KEYS.SETTINGS] ?? {}),
    });
  };

  const saveSettings = async (newSettings: Settings) => {
    setSettings(newSettings);
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: newSettings });
  };

  const handleNewSession = useCallback(() => {
    setShowHistory(false);
    setView("chat");
    setNewSessionSignal(n => n + 1);
  }, []);

  const handleToggleHistory = useCallback(() => {
    if (view === "settings") {
      setView("chat");
      setShowHistory(true);
    } else {
      setShowHistory(prev => !prev);
    }
  }, [view]);

  const handleToggleSettings = useCallback(async () => {
    if (view === "settings") {
      setView("chat");
    } else {
      setShowHistory(false);
      await loadSettings();
      setView("settings");
    }
  }, [view]);

  return (
    <div
      className="flex h-screen flex-col"
      style={{ backgroundColor: "var(--ap-bg-primary)", color: "var(--ap-text-primary)" }}
    >
      {/* 顶栏 */}
      <header
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--ap-border)" }}
      >
        <ThemeToggle mode={themeMode} onToggle={toggleTheme} />
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleNewSession}
            className="rounded p-1.5 transition-colors"
            style={{ color: "var(--ap-text-muted)" }}
            title="新建会话"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={handleToggleHistory}
            className="rounded p-1.5 transition-colors"
            style={view === "chat" && showHistory
              ? { backgroundColor: "var(--ap-bg-tertiary)", color: "var(--ap-text-primary)" }
              : { color: "var(--ap-text-muted)" }
            }
            title="会话历史"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button
            onClick={handleToggleSettings}
            className="rounded p-1.5 transition-colors"
            style={view === "settings"
              ? { backgroundColor: "var(--ap-bg-tertiary)", color: "var(--ap-text-primary)" }
              : { color: "var(--ap-text-muted)" }
            }
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* 内容区 */}
      <div className="relative flex-1 flex flex-col overflow-hidden">
        {view === "chat" ? (
          <ChatPanel
            showHistory={showHistory}
            onToggleHistory={handleToggleHistory}
            newSessionSignal={newSessionSignal}
          />
        ) : (
          <SettingsPanel settings={settings} onSave={saveSettings} />
        )}
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
}) {
  const [form, setForm] = useState(settings);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [capturedCount, setCapturedCount] = useState<number | null>(null);
  const [capturedList, setCapturedList] = useState<Array<{
    id: string;
    url: string;
    method: string;
    statusCode: number;
    timestamp: number;
  }> | null>(null);

  const refreshCaptured = useCallback(() => {
    try {
      chrome.runtime.sendMessage({ type: "GET_CAPTURED_COUNT" }, (res: { count: number }) => {
        if (res) setCapturedCount(res.count);
      });
      chrome.runtime.sendMessage({ type: "GET_CAPTURED_LIST" }, (res: { requests: any[] }) => {
        if (res) setCapturedList(res.requests);
      });
    } catch { /* SW 未就绪 */ }
  }, []);

  useEffect(() => {
    refreshCaptured();
  }, [refreshCaptured]);

  const handleClearCaptured = useCallback(() => {
    try {
      chrome.runtime.sendMessage({ type: "CLEAR_CAPTURED" }, () => {
        refreshCaptured();
      });
    } catch { /* ignore */ }
  }, [refreshCaptured]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    setSaveFeedback(true);
    setTimeout(() => setSaveFeedback(false), 1500);
  };

  const timeStr = BUILD_TIME.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex flex-1 flex-col gap-4 p-4 overflow-y-auto">
      {/* API 捕获状态 */}
      <div className="rounded px-3 py-2" style={{ backgroundColor: "var(--ap-bg-secondary)", border: "1px solid var(--ap-border)" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium" style={{ color: "var(--ap-text-secondary)" }}>API 捕获状态</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearCaptured}
              className="text-xs transition-colors hover:text-red-400"
              style={{ color: "var(--ap-text-muted)" }}
            >
              清空
            </button>
            <button
              onClick={refreshCaptured}
              className="text-xs transition-colors"
              style={{ color: "var(--ap-text-muted)" }}
            >
              刷新
            </button>
          </div>
        </div>
        {capturedCount === null ? (
          <span className="text-xs" style={{ color: "var(--ap-text-muted)" }}>检测中...</span>
        ) : capturedCount === 0 ? (
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs" style={{ color: "var(--ap-text-secondary)" }}>未捕获到任何请求</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-green-400">已捕获 {capturedCount} 个请求</span>
            </div>
            {capturedList && capturedList.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {capturedList.slice(0, 20).map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center gap-2 text-xs rounded px-2 py-1"
                    style={{ backgroundColor: "var(--ap-bg-primary)" }}
                  >
                    <span className={`shrink-0 px-1 rounded text-[10px] font-mono ${
                      req.statusCode < 400
                        ? "bg-green-900/50 text-green-400"
                        : "bg-red-900/50 text-red-400"
                    }`}>
                      {req.method}
                    </span>
                    <span style={{ color: "var(--ap-text-muted)" }}>{req.statusCode}</span>
                    <span className="truncate" style={{ color: "var(--ap-text-secondary)" }} title={req.url}>
                      {(() => { try { return new URL(req.url).pathname; } catch { return req.url; } })()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 设置表单 */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="API Key" type="password" value={form.apiKey} onChange={(v) => setForm({ ...form, apiKey: v })} />
        <Field label="Base URL" value={form.baseUrl} onChange={(v) => setForm({ ...form, baseUrl: v })} />
        <Field label="模型" value={form.model} onChange={(v) => setForm({ ...form, model: v })} />

        <button
          type="submit"
          className="mt-auto rounded px-4 py-2 text-sm font-medium transition-all duration-300"
          style={saveFeedback
            ? { backgroundColor: "#22c55e", color: "#ffffff" }
            : { backgroundColor: "var(--ap-accent)", color: "var(--ap-accent-text)" }
          }
        >
          {saveFeedback ? "已保存 ✓" : "保存设置"}
        </button>
      </form>
      </div>
      <p
        className="flex-shrink-0 text-xs text-center pb-4"
        style={{ color: "var(--ap-text-muted)", textShadow: "0 1px 1px rgba(0,0,0,0.06)" }}
      >
        Ariel v0.0.4 · 构建: {timeStr}
      </p>
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: "var(--ap-text-muted)" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded px-3 py-1.5 text-sm outline-none"
        style={{
          backgroundColor: "var(--ap-input-bg)",
          border: "1px solid var(--ap-input-border)",
          color: "var(--ap-text-primary)",
        }}
      />
    </label>
  );
}

export default App;
