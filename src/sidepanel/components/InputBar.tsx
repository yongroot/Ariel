import { useState, useRef, useEffect } from "react";

interface InputBarProps {
  onSend: (content: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
}

export default function InputBar({ onSend, onAbort, isStreaming }: InputBarProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const handleSubmit = () => {
    if (isStreaming) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        disabled={isStreaming}
        rows={1}
        className="flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none transition-colors disabled:opacity-50"
        style={{
          backgroundColor: "var(--ap-input-bg)",
          border: "1px solid var(--ap-input-border)",
          color: "var(--ap-text-primary)",
        }}
      />
      {isStreaming ? (
        <button
          onClick={onAbort}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors"
          style={{ color: "var(--ap-text-muted)", backgroundColor: "var(--ap-bg-tertiary)" }}
          title="停止生成"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
          style={{ color: "var(--ap-accent)", backgroundColor: "var(--ap-bg-tertiary)" }}
          title="发送"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
