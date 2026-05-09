import { useState, useEffect, useRef } from "react";
import { marked } from "marked";
import hljs from "highlight.js";

import type { Message } from "../../shared/types";
import "highlight.js/styles/github-dark-dimmed.css";
import { mountCharts } from "./ChartRenderer";

// Table index for unique IDs
let tableCounter = 0;

// Custom renderer: wraps <pre> with language header + copy button, <table> with export button
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang || "";

  if (language === "chart") {
    return `<div class="chart-placeholder my-2 rounded-lg border border-zinc-700 overflow-hidden" data-chart-config="${encodeURIComponent(text)}"></div>`;
  }

  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(text, { language }).value
    : hljs.highlightAuto(text).value;
  const escapedLang = language.replace(/"/g, "&quot;");
  return `<div class="code-block-wrapper my-2 rounded-lg border border-zinc-700 overflow-hidden">
  <div class="code-block-header flex items-center justify-between px-3 py-1 text-[11px] text-zinc-500 bg-zinc-800 border-b border-zinc-700">
    <span>${language || "code"}</span>
    <button class="code-copy-btn rounded px-1.5 py-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors" data-code="${encodeURIComponent(text)}">复制</button>
  </div>
  <pre class="!m-0 !rounded-none"><code class="hljs language-${escapedLang}">${highlighted}</code></pre>
</div>`;
};

// marked v18: renderer.table receives a token object, not pre-rendered strings.
// We need to build the HTML ourselves using this.parser or marked's internal helpers.
const _origTable = renderer.table.bind(renderer);
renderer.table = (token: Record<string, unknown>) => {
  const idx = tableCounter++;
  // Build header row
  const headerCells = (token.header as Array<Record<string, unknown>>)
    .map((cell: Record<string, unknown>) => {
      const align = cell.align ? ` align="${cell.align}"` : "";
      const rendered = marked.parseInline(cell.text as string, { async: false }) as string;
      return `<th${align}>${rendered}</th>`;
    }).join("");
  // Build body rows
  const bodyRows = (token.rows as Array<Array<Record<string, unknown>>>)
    .map((row: Array<Record<string, unknown>>) => {
      const cells = row
        .map((cell: Record<string, unknown>) => {
          const align = cell.align ? ` align="${cell.align}"` : "";
          const rendered = marked.parseInline(cell.text as string, { async: false }) as string;
          return `<td${align}>${rendered}</td>`;
        }).join("");
      return `<tr>${cells}</tr>`;
    }).join("\n");

  return `<div class="table-wrapper my-2 rounded-lg border border-zinc-700 overflow-hidden">
  <div class="table-header flex items-center justify-end px-2 py-1 text-[11px] text-zinc-500 bg-zinc-800/50 border-b border-zinc-700">
    <button class="table-export-btn flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors" data-table-idx="${idx}">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      导出 tsv
    </button>
  </div>
  <div class="overflow-x-auto"><table data-table-idx="${idx}"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>
</div>`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

export default function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [showReasoning, setShowReasoning] = useState(false);

  return (
    <div className={`mb-3 ${isUser ? "flex justify-end" : ""}`}>
      <div
        className="max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed"
        style={isUser
          ? { backgroundColor: "var(--ap-user-bubble)", color: "var(--ap-user-bubble-text)" }
          : { backgroundColor: "var(--ap-ai-bubble)", color: "var(--ap-text-primary)" }
        }
      >
        {/* Reasoning */}
        {message.reasoning && (
          <details
            className="mb-2 border-b border-zinc-700 pb-2"
            open={isStreaming || showReasoning}
            onToggle={(e) => setShowReasoning((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer select-none text-xs text-zinc-500 hover:text-zinc-400">
              💭 思考过程 {isStreaming && <span className="animate-pulse">...</span>}
            </summary>
            <div className="mt-1.5 max-h-48 overflow-y-auto text-xs leading-relaxed text-zinc-500 whitespace-pre-wrap">
              {message.reasoning}
              {isStreaming && (
                <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-zinc-600" />
              )}
            </div>
          </details>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map((tc) => {
              const result = message.toolResults?.find(
                (tr) => tr.toolCallId === tc.id
              );
              return (
                <ToolCallCard
                  key={tc.id}
                  name={tc.name}
                  args={tc.args}
                  result={result?.result}
                  error={result?.error}
                  isLoading={isStreaming && !result}
                />
              );
            })}
          </div>
        )}

        {/* Text content */}
        {message.content && (
          <div className="prose prose-sm max-w-none">
            {!isUser ? (
              <MarkdownRenderer content={message.content} />
            ) : (
              <span className="whitespace-pre-wrap">{message.content}</span>
            )}
          </div>
        )}

        {/* Streaming cursor */}
        {isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-zinc-400" />
        )}
      </div>

      {/* Download button for AI messages */}
      {!isUser && message.content && !isStreaming && (
        <div className="mt-1 flex justify-start">
          <button
            onClick={() => downloadMarkdown(message.content)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="下载为 Markdown 文件"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            下载 .md
          </button>
        </div>
      )}
    </div>
  );
}

function downloadMarkdown(content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ariel-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Parse an HTML <table> element into a 2D array of strings */
function parseTableData(tableEl: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  // Process <thead> first
  const thead = tableEl.querySelector("thead");
  if (thead) {
    for (const tr of thead.querySelectorAll("tr")) {
      const row: string[] = [];
      for (const cell of tr.querySelectorAll("th, td")) {
        row.push((cell.textContent ?? "").trim());
      }
      if (row.length > 0) rows.push(row);
    }
  }
  // Process <tbody> and orphan <tr>s
  const tbody = tableEl.querySelector("tbody");
  const trs = tbody ? tbody.querySelectorAll("tr") : tableEl.querySelectorAll(":scope > tr");
  for (const tr of trs) {
    // Skip rows already in thead
    if (thead?.contains(tr)) continue;
    const row: string[] = [];
    for (const cell of tr.querySelectorAll("th, td")) {
      row.push((cell.textContent ?? "").trim());
    }
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

/** Export a table element to TSV and trigger download */
function exportTableToTsv(tableEl: HTMLTableElement, idx: number) {
  const data = parseTableData(tableEl);
  if (data.length === 0) return;
  const tsv = data.map(row => row.map(cell => cell.replace(/\t/g, " ").replace(/\n/g, " ")).join("\t")).join("\n");
  const blob = new Blob(["\uFEFF" + tsv], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ariel-table-${idx + 1}.tsv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Markdown renderer with syntax highlighting, code copy buttons, and table export buttons */
function MarkdownRenderer({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Reset table counter per render
  tableCounter = 0;
  const html = marked.parse(content, { async: false }) as string;

  // Event delegation for copy buttons + table export buttons + mount charts
  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // Mount ECharts on .chart-placeholder elements
    const cleanupCharts = mountCharts(container);

    const handler = (e: Event) => {
      // Code copy button
      const copyBtn = (e.target as HTMLElement).closest(".code-copy-btn");
      if (copyBtn) {
        e.preventDefault();
        const encoded = copyBtn.getAttribute("data-code");
        if (!encoded) return;
        const text = decodeURIComponent(encoded);
        navigator.clipboard.writeText(text);
        copyBtn.textContent = "已复制!";
        setTimeout(() => { copyBtn.textContent = "复制"; }, 1500);
        return;
      }

      // Table export button
      const exportBtn = (e.target as HTMLElement).closest(".table-export-btn");
      if (exportBtn) {
        e.preventDefault();
        const idx = exportBtn.getAttribute("data-table-idx");
        if (idx === null) return;
        const tableEl = container.querySelector(`table[data-table-idx="${idx}"]`) as HTMLTableElement;
        if (!tableEl) return;
        exportTableToTsv(tableEl, parseInt(idx, 10));
        exportBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> 已导出`;
        setTimeout(() => {
          exportBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 导出 tsv`;
        }, 1500);
      }
    };
    container.addEventListener("click", handler);
    return () => {
      container.removeEventListener("click", handler);
      cleanupCharts();
    };
  }, [content]);

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

function ToolCallCard({
  name,
  args,
  result,
  error,
  isLoading,
}: {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  isLoading?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!error);

  const statusIcon = error
    ? "❌"
    : result !== undefined
      ? "✅"
      : isLoading
        ? "⏳"
        : "🔧";

  const statusLabel = error
    ? "失败"
    : result !== undefined
      ? "完成"
      : isLoading
        ? "执行中"
        : "调用";

  const resultSummary = (() => {
    if (error) return error;
    if (result === undefined) return undefined;
    const str = typeof result === "string" ? result : JSON.stringify(result);
    if (!str) return "（空）";
    if (str.length <= 60) return str;
    return `${str.slice(0, 57)}...`;
  })();

  return (
    <details
      className="rounded border border-zinc-700 bg-zinc-900/50 text-xs"
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none px-2 py-1.5 text-zinc-400 hover:text-zinc-200">
        {statusIcon} {name} — {statusLabel}
        {resultSummary !== undefined && !expanded && (
          <span className="ml-2 text-zinc-600">{resultSummary}</span>
        )}
      </summary>
      <div className="border-t border-zinc-700 px-2 py-1.5">
        <div className="mb-1 text-zinc-500">参数:</div>
        <pre className="overflow-x-auto rounded bg-zinc-950 p-1.5 text-zinc-300">
          {JSON.stringify(args, null, 2)}
        </pre>
        {result !== undefined && (
          <>
            <div className="mb-1 mt-2 text-zinc-500">结果:</div>
            <pre className="max-h-96 overflow-auto rounded bg-zinc-950 p-1.5 text-zinc-300">
              {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
            </pre>
          </>
        )}
        {error && (
          <div className="mt-2 text-red-400">{error}</div>
        )}
      </div>
    </details>
  );
}
