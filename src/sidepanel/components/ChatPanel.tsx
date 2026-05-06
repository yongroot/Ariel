import { useState, useRef, useEffect, useCallback } from "react";
import type { Message, ToolCall, Session } from "../../shared/types";
import type { StreamEvent } from "../../shared/protocol";
import { STORAGE_KEYS } from "../../shared/constants";
import { formatTime } from "../../shared/theme";
import MessageBubble from "./MessageBubble";
import InputBar from "./InputBar";

function createSession(): Session {
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    messages: [],
    starred: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function generateTitle(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 30) return trimmed;
  return trimmed.slice(0, 30) + "...";
}

interface ChatPanelProps {
  showHistory: boolean;
  onToggleHistory: () => void;
  newSessionSignal: number;
}

export default function ChatPanel({ showHistory, onToggleHistory, newSessionSignal }: ChatPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentContent, setCurrentContent] = useState("");
  const [currentReasoning, setCurrentReasoning] = useState("");
  const [currentToolCalls, setCurrentToolCalls] = useState<
    (ToolCall & { result?: unknown; error?: string })[]
  >([]);
  const [streamingElapsed, setStreamingElapsed] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<Session[]>(sessions);
  const activeIdRef = useRef<string | null>(activeSessionId);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const skipAutoScrollRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { activeIdRef.current = activeSessionId; }, [activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const messages = activeSession?.messages ?? [];
  const isEmpty = messages.length === 0 && !isStreaming;

  // Load sessions on mount, auto-create if empty
  useEffect(() => {
    const initSessions = (loaded: Session[] | undefined, activeId: string | undefined) => {
      if (Array.isArray(loaded) && loaded.length > 0) {
        setSessions(loaded);
        const restoreId = activeId && loaded.find(s => s.id === activeId)
          ? activeId
          : loaded.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b).id;
        setActiveSessionId(restoreId);
      } else {
        // Migrate old HISTORY format to sessions
        chrome.storage.local.get(STORAGE_KEYS.HISTORY, (histResult) => {
          const oldMessages = histResult[STORAGE_KEYS.HISTORY] as Message[] | undefined;
          if (Array.isArray(oldMessages) && oldMessages.length > 0) {
            const session: Session = {
              id: crypto.randomUUID(),
              title: oldMessages.find(m => m.role === "user")?.content.slice(0, 30) || "历史对话",
              messages: oldMessages,
              starred: false,
              createdAt: oldMessages[0]?.timestamp || Date.now(),
              updatedAt: oldMessages[oldMessages.length - 1]?.timestamp || Date.now(),
            };
            setSessions([session]);
            setActiveSessionId(session.id);
            saveSessions([session], session.id);
            chrome.storage.local.remove(STORAGE_KEYS.HISTORY);
          } else {
            const session = createSession();
            setSessions([session]);
            setActiveSessionId(session.id);
            saveSessions([session], session.id);
          }
        });
      }
    };

    try {
      chrome.storage.local.get([STORAGE_KEYS.SESSIONS, STORAGE_KEYS.ACTIVE_SESSION], (result) => {
        initSessions(
          result[STORAGE_KEYS.SESSIONS] as Session[] | undefined,
          result[STORAGE_KEYS.ACTIVE_SESSION] as string | undefined,
        );
      });
    } catch { /* ignore */ }
  }, []);

  function saveSessions(updatedSessions: Session[], newActiveId?: string) {
    sessionsRef.current = updatedSessions;
    chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS]: updatedSessions });
    if (newActiveId !== undefined) {
      chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SESSION]: newActiveId });
    }
  }

  function updateSessionMessages(sessionId: string, msgs: Message[]) {
    setSessions(prev => {
      const updated = prev.map(s =>
        s.id === sessionId
          ? { ...s, messages: msgs, updatedAt: Date.now(), title: s.id === sessionId && s.title === "新对话" && msgs.find(m => m.role === "user")
              ? generateTitle(msgs.find(m => m.role === "user")!.content)
              : s.title }
          : s
      );
      saveSessions(updated);
      return updated;
    });
  }

  // Auto-scroll to bottom when new content arrives (skip on session switch)
  useEffect(() => {
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentContent, currentReasoning, currentToolCalls]);

  // Streaming timer
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setStreamingElapsed(0);
    timerRef.current = setInterval(() => {
      setStreamingElapsed(Math.floor((Date.now() - startTimeRef.current) / 100) / 10);
    }, 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleNewSession = useCallback(() => {
    if (isStreaming) return;
    // 空会话时忽略，避免创建无意义的"新对话"
    const current = sessionsRef.current.find(s => s.id === activeIdRef.current);
    if (current && current.messages.length === 0) return;
    const session = createSession();
    setSessions(prev => {
      const next = [session, ...prev];
      saveSessions(next, session.id);
      return next;
    });
    setActiveSessionId(session.id);
    setCurrentContent("");
    setCurrentReasoning("");
    setCurrentToolCalls([]);
  }, [isStreaming]);

  // 响应 App 顶栏的新建会话信号
  useEffect(() => {
    if (newSessionSignal > 0) {
      handleNewSession();
    }
  }, [newSessionSignal]);

  const handleSwitchSession = useCallback((id: string) => {
    if (isStreaming || id === activeIdRef.current) return;
    skipAutoScrollRef.current = true;
    setActiveSessionId(id);
    chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SESSION]: id });
    setCurrentContent("");
    setCurrentReasoning("");
    setCurrentToolCalls([]);
    onToggleHistory();
  }, [isStreaming, onToggleHistory]);

  const handleDeleteSession = useCallback((id: string) => {
    if (isStreaming) return;
    skipAutoScrollRef.current = true;
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      saveSessions(next);
      if (activeIdRef.current === id) {
        const newActive = next.length > 0 ? next[0].id : null;
        setActiveSessionId(newActive);
        if (newActive) {
          chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SESSION]: newActive });
        } else {
          chrome.storage.local.remove(STORAGE_KEYS.ACTIVE_SESSION);
        }
      }
      return next;
    });
  }, [isStreaming]);

  const handleToggleStar = useCallback((id: string) => {
    setSessions(prev => {
      const next = prev.map(s => s.id === id ? { ...s, starred: !s.starred } : s);
      next.sort((a, b) => {
        if (a.starred !== b.starred) return a.starred ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
      saveSessions(next);
      return next;
    });
  }, []);

  const handleSend = useCallback((content: string) => {
    if (!content.trim() || !activeIdRef.current) return;

    const sid = activeIdRef.current;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };

    // Add user message immediately
    setSessions(prev => {
      const next = prev.map(s =>
        s.id === sid
          ? {
              ...s,
              messages: [...s.messages, userMsg],
              updatedAt: Date.now(),
              title: s.title === "新对话" ? generateTitle(content.trim()) : s.title,
            }
          : s
      );
      saveSessions(next);
      return next;
    });

    setIsStreaming(true);
    setCurrentContent("");
    setCurrentReasoning("");
    setCurrentToolCalls([]);
    startTimer();

    let fullContent = "";
    let fullReasoning = "";
    const toolCalls: (ToolCall & { result?: unknown; error?: string })[] = [];

    const port = chrome.runtime.connect({ name: "chat-stream" });
    portRef.current = port;

    port.onMessage.addListener((event: StreamEvent) => {
      switch (event.type) {
        case "REASONING_DELTA":
          fullReasoning += event.content;
          setCurrentReasoning(fullReasoning);
          break;
        case "TEXT_DELTA":
          fullContent += event.content;
          setCurrentContent(fullContent);
          break;
        case "TOOL_CALL":
          toolCalls.push({ id: event.id, name: event.tool, args: event.args });
          setCurrentToolCalls([...toolCalls]);
          break;
        case "TOOL_RESULT": {
          const tc = toolCalls.find((t) => t.id === event.id);
          if (tc) { tc.result = event.result; tc.error = event.error; setCurrentToolCalls([...toolCalls]); }
          break;
        }
        case "DONE": {
          if (fullContent || fullReasoning || toolCalls.length > 0) {
            const aiMsg: Message = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: fullContent,
              reasoning: fullReasoning || undefined,
              toolCalls: toolCalls.map(({ id, name, args }) => ({ id, name, args })),
              toolResults: toolCalls.map(({ id, name, result, error }) => ({ toolCallId: id, name, result, error })),
              timestamp: Date.now(),
            };
            const currentSession = sessionsRef.current.find(s => s.id === sid);
            const existingMsgs = currentSession?.messages ?? [];
            updateSessionMessages(sid, [...existingMsgs, aiMsg]);
          }
          cleanup();
          break;
        }
        case "ERROR": {
          const errorMsg: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `⚠️ ${event.message}`,
            timestamp: Date.now(),
          };
          const currentSession = sessionsRef.current.find(s => s.id === sid);
          const existingMsgs = currentSession?.messages ?? [];
          updateSessionMessages(sid, [...existingMsgs, errorMsg]);
          cleanup();
          break;
        }
      }
    });

    port.onDisconnect.addListener(() => {
      // If port disconnects unexpectedly (e.g. SW crashed), clean up
      if (portRef.current === port) {
        cleanup();
      }
    });

    function cleanup() {
      stopTimer();
      setStreamingElapsed(0);
      fullContent = "";
      fullReasoning = "";
      setCurrentContent("");
      setCurrentReasoning("");
      setCurrentToolCalls([]);
      setIsStreaming(false);
      portRef.current = null;
      try { port.disconnect(); } catch { /* already disconnected */ }
    }

    // Send history from current session
    const currentSession = sessionsRef.current.find(s => s.id === sid);
    const historyToSend = (currentSession?.messages ?? []).filter(m => m.id !== userMsg.id);
    port.postMessage({
      type: "CHAT_SEND",
      content: content.trim(),
      history: historyToSend,
    });
  }, [startTimer, stopTimer]);

  const handleAbort = useCallback(() => {
    // Send abort through port (not sendMessage) so SW can abort the fetch
    if (portRef.current) {
      try {
        portRef.current.postMessage({ type: "CHAT_ABORT" });
      } catch { /* port may be broken */ }
    }

    // Save partial content as a message
    const sid = activeIdRef.current;
    if (sid && (currentContent || currentReasoning)) {
      const partialMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: currentContent,
        reasoning: currentReasoning || undefined,
        timestamp: Date.now(),
      };
      const currentSession = sessionsRef.current.find(s => s.id === sid);
      updateSessionMessages(sid, [...(currentSession?.messages ?? []), partialMsg]);
    }

    // Clean up local state
    stopTimer();
    setStreamingElapsed(0);
    setIsStreaming(false);
    setCurrentContent("");
    setCurrentReasoning("");
    setCurrentToolCalls([]);
    portRef.current = null;
  }, [currentContent, currentReasoning, stopTimer]);

  // Scroll tracking for floating buttons
  const [showScrollBtns, setShowScrollBtns] = useState(false);
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollBtns(scrollTop > 200 || distFromBottom > 200);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Format elapsed time
  const elapsedStr = streamingElapsed < 60
    ? `${streamingElapsed.toFixed(1)}s`
    : `${Math.floor(streamingElapsed / 60)}m ${(streamingElapsed % 60).toFixed(0)}s`;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 消息列表 */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-3"
        onScroll={handleScroll}
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming && (currentReasoning || currentContent || currentToolCalls.length > 0) && (
          <MessageBubble
            message={{
              id: "streaming",
              role: "assistant",
              content: currentContent,
              reasoning: currentReasoning || undefined,
              toolCalls: currentToolCalls.map(({ id, name, args }) => ({ id, name, args })),
              toolResults: currentToolCalls
                .filter((t) => t.result !== undefined || t.error)
                .map(({ id, name, result, error }) => ({ toolCallId: id, name, result, error })),
              timestamp: Date.now(),
            }}
            isStreaming={true}
          />
        )}

        {/* 流式计时器 */}
        {isStreaming && (
          <div className="mt-2 text-center">
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]"
              style={{ backgroundColor: "var(--ap-bg-tertiary)", color: "var(--ap-text-muted)" }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              {elapsedStr}
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 滚动按钮 */}
      {showScrollBtns && !isEmpty && (
        <div className="absolute bottom-16 left-3 right-3 flex justify-between pointer-events-none z-10">
          <button
            onClick={scrollToTop}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full shadow transition-colors"
            style={{ backgroundColor: "var(--ap-bg-tertiary)", color: "var(--ap-text-muted)" }}
            title="跳到顶部"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
          <button
            onClick={scrollToBottom}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full shadow transition-colors"
            style={{ backgroundColor: "var(--ap-bg-tertiary)", color: "var(--ap-text-muted)" }}
            title="回到底部"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </button>
        </div>
      )}

      {/* 输入栏 */}
      <div
        className={`flex-shrink-0 px-2 pb-2 transition-all duration-500 ease-out ${isEmpty ? "absolute inset-0 flex items-center justify-center" : ""}`}
      >
        <div className={isEmpty ? "w-full max-w-lg" : ""}>
          <InputBar
            onSend={handleSend}
            onAbort={handleAbort}
            isStreaming={isStreaming}
          />
        </div>
      </div>

      {/* 会话历史侧栏 */}
      {showHistory && (
        <SessionHistory
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSwitchSession}
          onDelete={handleDeleteSession}
          onToggleStar={handleToggleStar}
          onClose={onToggleHistory}
        />
      )}
    </div>
  );
}

function SessionHistory({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onToggleStar,
  onClose,
}: {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, []);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col"
      style={{ backgroundColor: "var(--ap-bg-primary)" }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--ap-border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--ap-text-secondary)" }}>会话历史</h2>
        <button onClick={onClose} className="text-xs" style={{ color: "var(--ap-text-muted)" }}>✕</button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <div className="text-center text-xs py-8" style={{ color: "var(--ap-text-muted)" }}>暂无会话记录</div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="group mb-1 rounded-lg px-3 py-2 cursor-pointer transition-colors"
              style={{
                backgroundColor: session.id === activeSessionId ? "var(--ap-bg-secondary)" : "transparent",
              }}
              onClick={() => onSelect(session.id)}
            >
              <div className="flex items-start gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleStar(session.id); }}
                  className="mt-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
                  style={{ color: session.starred ? "var(--ap-accent)" : "var(--ap-text-muted)" }}
                  title={session.starred ? "取消标星" : "标星"}
                >
                  {session.starred ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate" style={{ color: "var(--ap-text-primary)" }}>
                      {session.title}
                    </span>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
                        className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                        style={{ color: "var(--ap-text-muted)" }}
                        title="删除"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px]" style={{ color: "var(--ap-text-muted)" }}>
                    <span>{formatTime(session.createdAt)}</span>
                    <span>—</span>
                    <span>{formatTime(session.updatedAt)}</span>
                    <span className="ml-auto">{session.messages.length} 条消息</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
