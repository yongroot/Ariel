// Fixed light/dark theme palettes (GitHub-inspired)

export type ThemeMode = "light" | "dark";

export interface Palette {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  accent: string;
  accentHover: string;
  accentText: string;
  userBubble: string;
  userBubbleText: string;
  aiBubble: string;
  codeBg: string;
  inputBg: string;
  inputBorder: string;
}

export const LIGHT_PALETTE: Palette = {
  bgPrimary: "#ffffff",
  bgSecondary: "#f6f8fa",
  bgTertiary: "#eaeef2",
  textPrimary: "#1f2328",
  textSecondary: "#656d76",
  textMuted: "#8b949e",
  border: "#d0d7de",
  accent: "#0969da",
  accentHover: "#0550ae",
  accentText: "#ffffff",
  userBubble: "#ddf4ff",
  userBubbleText: "#0969da",
  aiBubble: "#f6f8fa",
  codeBg: "#f6f8fa",
  inputBg: "#ffffff",
  inputBorder: "#d0d7de",
};

export const DARK_PALETTE: Palette = {
  bgPrimary: "#0d1117",
  bgSecondary: "#161b22",
  bgTertiary: "#21262d",
  textPrimary: "#e6edf3",
  textSecondary: "#8b949e",
  textMuted: "#484f58",
  border: "#30363d",
  accent: "#58a6ff",
  accentHover: "#79c0ff",
  accentText: "#ffffff",
  userBubble: "#1f6feb",
  userBubbleText: "#ffffff",
  aiBubble: "#161b22",
  codeBg: "#0d1117",
  inputBg: "#0d1117",
  inputBorder: "#30363d",
};

export function getPalette(mode: ThemeMode): Palette {
  return mode === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}

export function applyPalette(root: HTMLElement, palette: Palette) {
  const s = root.style;
  s.setProperty("--ap-bg-primary", palette.bgPrimary);
  s.setProperty("--ap-bg-secondary", palette.bgSecondary);
  s.setProperty("--ap-bg-tertiary", palette.bgTertiary);
  s.setProperty("--ap-text-primary", palette.textPrimary);
  s.setProperty("--ap-text-secondary", palette.textSecondary);
  s.setProperty("--ap-text-muted", palette.textMuted);
  s.setProperty("--ap-border", palette.border);
  s.setProperty("--ap-accent", palette.accent);
  s.setProperty("--ap-accent-hover", palette.accentHover);
  s.setProperty("--ap-accent-text", palette.accentText);
  s.setProperty("--ap-user-bubble", palette.userBubble);
  s.setProperty("--ap-user-bubble-text", palette.userBubbleText);
  s.setProperty("--ap-ai-bubble", palette.aiBubble);
  s.setProperty("--ap-code-bg", palette.codeBg);
  s.setProperty("--ap-input-bg", palette.inputBg);
  s.setProperty("--ap-input-border", palette.inputBorder);
}

/** Format timestamp to yyyy/MM/dd hh:mm:ss */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
