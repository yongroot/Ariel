import { useState, useEffect, useCallback, useRef } from "react";
import ChatPanel from "./components/ChatPanel";
import type { Settings } from "../shared/types";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../shared/constants";
import { generatePalette, applyPalette } from "../shared/theme";

// 构建时间戳（vite.config.ts 里 define 的 __BUILD_TIME__）
declare const __BUILD_TIME__: number;

const BUILD_TIME = typeof __BUILD_TIME__ === "number"
  ? new Date(__BUILD_TIME__)
  : new Date();

function App() {
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [showHistory, setShowHistory] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [newSessionSignal, setNewSessionSignal] = useState(0);
  const lastBgRef = useRef<string | null>(null);

  // === Adaptive theme polling ===
  useEffect(() => {
    const pollTheme = () => {
      try {
        chrome.runtime.sendMessage({ type: "GET_PAGE_THEME" }, (theme: { bg: string } | null) => {
          if (theme?.bg && theme.bg !== lastBgRef.current) {
            lastBgRef.current = theme.bg;
            const palette = generatePalette(theme.bg);
            applyPalette(document.documentElement, palette);
          }
        });
      } catch { /* ignore */ }
    };
    pollTheme();
    const interval = setInterval(pollTheme, 3000);
    return () => clearInterval(interval);
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
        <h1 className="text-sm font-semibold tracking-wide" style={{ color: "var(--ap-text-secondary)" }}>
          Ariel
        </h1>
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
      <div className="relative flex-1">
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  const timeStr = BUILD_TIME.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 overflow-y-auto">
      {/* 版本信息 */}
      <div className="rounded px-3 py-2" style={{ backgroundColor: "var(--ap-bg-secondary)", border: "1px solid var(--ap-border)" }}>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "var(--ap-text-muted)" }}>Ariel v0.0.1</span>
          <span className="text-xs" style={{ color: "var(--ap-text-muted)" }}>构建: {timeStr}</span>
        </div>
      </div>

      {/* API 捕获状态 */}
      <div className="rounded px-3 py-2" style={{ backgroundColor: "var(--ap-bg-secondary)", border: "1px solid var(--ap-border)" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium" style={{ color: "var(--ap-text-secondary)" }}>API 捕获状态</span>
          <button
            onClick={refreshCaptured}
            className="text-xs transition-colors"
            style={{ color: "var(--ap-text-muted)" }}
          >
            刷新
          </button>
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
          className="mt-auto rounded px-4 py-2 text-sm font-medium transition-colors"
          style={{ backgroundColor: "var(--ap-accent)", color: "var(--ap-accent-text)" }}
        >
          保存设置
        </button>
      </form>
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
