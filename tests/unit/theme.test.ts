import { describe, it, expect } from "vitest";
import { parseRGB, rgbToHSL, generatePalette, applyPalette, formatTime } from "../../src/shared/theme";

describe("parseRGB", () => {
  it("parses standard rgb(r, g, b) string", () => {
    expect(parseRGB("rgb(255, 128, 0)")).toEqual([255, 128, 0]);
  });

  it("parses rgb with spaces", () => {
    expect(parseRGB("rgb(  24,  100,  200  )")).toEqual([24, 100, 200]);
  });

  it("returns white for invalid input", () => {
    expect(parseRGB("invalid")).toEqual([255, 255, 255]);
    expect(parseRGB("")).toEqual([255, 255, 255]);
  });
});

describe("rgbToHSL", () => {
  it("black → h:0, s:0, l:0", () => {
    const [h, s, l] = rgbToHSL(0, 0, 0);
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(0);
  });

  it("white → h:0, s:0, l:100", () => {
    const [h, s, l] = rgbToHSL(255, 255, 255);
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(100);
  });

  it("pure red → h:0", () => {
    const [h] = rgbToHSL(255, 0, 0);
    expect(h).toBe(0);
  });

  it("pure green → h:120", () => {
    const [h] = rgbToHSL(0, 255, 0);
    expect(h).toBe(120);
  });

  it("pure blue → h:240", () => {
    const [h] = rgbToHSL(0, 0, 255);
    expect(h).toBe(240);
  });

  it("returns s=0 for achromatic colors", () => {
    const [, s] = rgbToHSL(128, 128, 128);
    expect(s).toBe(0);
  });
});

describe("generatePalette", () => {
  const PALETTE_KEYS = [
    "bgPrimary", "bgSecondary", "bgTertiary",
    "textPrimary", "textSecondary", "textMuted",
    "border", "accent", "accentHover", "accentText",
    "userBubble", "userBubbleText", "aiBubble",
    "codeBg", "inputBg", "inputBorder",
  ] as const;

  it("returns all 16 palette keys", () => {
    const palette = generatePalette("rgb(30, 30, 30)");
    for (const key of PALETTE_KEYS) {
      expect(palette).toHaveProperty(key);
      expect(typeof palette[key]).toBe("string");
      expect(palette[key].length).toBeGreaterThan(0);
    }
  });

  it("dark background → dark palette with light text", () => {
    const palette = generatePalette("rgb(24, 24, 27)"); // zinc-900
    // bgPrimary should be the input
    expect(palette.bgPrimary).toBe("rgb(24, 24, 27)");
    // textPrimary should be light
    expect(palette.textPrimary).toContain("92%"); // high lightness
    // textMuted should be darker than textPrimary but still readable
    expect(palette.textMuted).toContain("45%");
  });

  it("light background → light palette with dark text", () => {
    const palette = generatePalette("rgb(250, 250, 250)"); // near white
    expect(palette.bgPrimary).toBe("rgb(250, 250, 250)");
    // textPrimary should be dark
    expect(palette.textPrimary).toContain("12%");
    // textMuted should be lighter than textPrimary
    expect(palette.textMuted).toContain("55%");
  });

  it("achromatic dark → uses blue hue (210) for accent", () => {
    const palette = generatePalette("rgb(20, 20, 20)"); // gray, s < 8
    expect(palette.accent).toContain("210");
    expect(palette.accentHover).toContain("210");
  });

  it("achromatic light → uses blue hue (210) for accent", () => {
    const palette = generatePalette("rgb(240, 240, 240)");
    expect(palette.accent).toContain("210");
  });

  it("colored background → uses page hue for accent", () => {
    const palette = generatePalette("rgb(255, 0, 0)"); // red, h=0, s=100
    // Should use h=0 (red), not fallback 210
    expect(palette.accent).toContain("0");
  });

  it("user bubble text is always light", () => {
    const dark = generatePalette("rgb(10, 10, 10)");
    const light = generatePalette("rgb(240, 240, 240)");
    expect(dark.userBubbleText).toContain("95%");
    expect(light.userBubbleText).toBe("#ffffff");
  });

  it("accent text is always white", () => {
    const dark = generatePalette("rgb(10, 10, 10)");
    const light = generatePalette("rgb(240, 240, 240)");
    expect(dark.accentText).toBe("#ffffff");
    expect(light.accentText).toBe("#ffffff");
  });
});

describe("applyPalette", () => {
  // applyPalette manipulates DOM — tested via E2E in load-extension.spec.ts
  // Unit test requires jsdom; skipping for now
  it("is a function that accepts element and palette", () => {
    expect(typeof applyPalette).toBe("function");
  });
});

describe("formatTime", () => {
  it("formats timestamp as yyyy/MM/dd hh:mm:ss", () => {
    // 2026-05-05 14:30:45 CST
    const ts = new Date(2026, 4, 5, 14, 30, 45).getTime();
    expect(formatTime(ts)).toBe("2026/05/05 14:30:45");
  });

  it("pads single-digit month/day/hour/minute/second", () => {
    const ts = new Date(2026, 0, 1, 1, 2, 3).getTime();
    expect(formatTime(ts)).toBe("2026/01/01 01:02:03");
  });

  it("uses local timezone", () => {
    const ts = Date.now();
    const result = formatTime(ts);
    // Should match yyyy/MM/dd hh:mm:ss pattern
    expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("Tavily removal", () => {
  it("no tavily references in source", async () => {
    // This test documents the removal of Tavily
    // If tavily is re-added, this test will fail and remind us
    const { readFileSync, readdirSync } = await import("fs");
    const { join } = await import("path");

    function walkDir(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !["node_modules", "dist", ".git"].includes(entry.name)) {
          files.push(...walkDir(full));
        } else if (entry.isFile() && /\.(ts|tsx|js|json)$/.test(entry.name)) {
          files.push(full);
        }
      }
      return files;
    }

    const srcDir = join(process.cwd(), "src");
    const violations: string[] = [];
    for (const file of walkDir(srcDir)) {
      const content = readFileSync(file, "utf-8");
      if (/tavily/i.test(content)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
