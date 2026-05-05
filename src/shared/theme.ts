// HSL Color Wheel Palette Generator
// Extracted for testability — used by sidepanel/App.tsx

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

export function parseRGB(rgb: string): [number, number, number] {
  const m = rgb.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

export function rgbToHSL(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

export function generatePalette(bgStr: string): Palette {
  const [r, g, b] = parseRGB(bgStr);
  const [h, s, l] = rgbToHSL(r, g, b);
  const isDark = l < 50;
  const achromatic = s < 8;
  const hue = achromatic ? 210 : h;

  if (isDark) {
    const bg2 = `hsl(${hue}, ${Math.max(s - 2, 2)}%, ${Math.min(l + 8, 60)}%)`;
    const bg3 = `hsl(${hue}, ${Math.max(s - 2, 2)}%, ${Math.min(l + 16, 70)}%)`;
    return {
      bgPrimary: bgStr,
      bgSecondary: bg2,
      bgTertiary: bg3,
      textPrimary: `hsl(${hue}, ${Math.max(s - 4, 2)}%, 92%)`,
      textSecondary: `hsl(${hue}, ${Math.max(s - 6, 2)}%, 68%)`,
      textMuted: `hsl(${hue}, ${Math.max(s - 6, 2)}%, 45%)`,
      border: `hsl(${hue}, ${Math.max(s - 4, 2)}%, ${Math.min(l + 18, 50)}%)`,
      accent: achromatic ? `hsl(210, 65%, 50%)` : `hsl(${hue}, 65%, 50%)`,
      accentHover: achromatic ? `hsl(210, 65%, 42%)` : `hsl(${hue}, 65%, 42%)`,
      accentText: "#ffffff",
      userBubble: `hsl(${hue}, ${Math.min(s + 10, 40)}%, ${Math.min(l + 12, 45)}%)`,
      userBubbleText: `hsl(0, 0%, 93%)`,
      aiBubble: bg2,
      codeBg: `hsl(${hue}, ${Math.max(s - 4, 2)}%, ${Math.max(l - 6, 5)}%)`,
      inputBg: bg2,
      inputBorder: `hsl(${hue}, ${Math.max(s - 4, 2)}%, ${Math.min(l + 18, 50)}%)`,
    };
  } else {
    const bg2 = `hsl(${hue}, ${Math.max(s - 2, 2)}%, ${Math.max(l - 5, 10)}%)`;
    const bg3 = `hsl(${hue}, ${Math.max(s - 2, 2)}%, ${Math.max(l - 10, 8)}%)`;
    return {
      bgPrimary: bgStr,
      bgSecondary: bg2,
      bgTertiary: bg3,
      textPrimary: `hsl(${hue}, ${Math.max(s - 4, 2)}%, 12%)`,
      textSecondary: `hsl(${hue}, ${Math.max(s - 6, 2)}%, 35%)`,
      textMuted: `hsl(${hue}, ${Math.max(s - 6, 2)}%, 55%)`,
      border: `hsl(${hue}, ${Math.max(s - 4, 2)}%, ${Math.max(l - 15, 15)}%)`,
      accent: achromatic ? `hsl(210, 65%, 45%)` : `hsl(${hue}, 65%, 45%)`,
      accentHover: achromatic ? `hsl(210, 65%, 38%)` : `hsl(${hue}, 65%, 38%)`,
      accentText: "#ffffff",
      userBubble: `hsl(${hue}, ${Math.min(s + 15, 50)}%, ${Math.max(l - 3, 90)}%)`,
      userBubbleText: `hsl(${hue}, ${Math.max(s - 2, 10)}%, 20%)`,
      aiBubble: bg2,
      codeBg: `hsl(${hue}, ${Math.max(s - 4, 2)}%, ${Math.max(l - 8, 5)}%)`,
      inputBg: bg2,
      inputBorder: `hsl(${hue}, ${Math.max(s - 4, 2)}%, ${Math.max(l - 15, 15)}%)`,
    };
  }
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
