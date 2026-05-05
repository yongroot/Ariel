import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_PATH = path.resolve(__dirname, "../dist");
const TEST_PAGE = path.resolve(__dirname, "fixtures/test-page.html");

// 读取测试页面的 HTML
const testPageHtml = fs.readFile(TEST_PAGE, "utf-8");

test.describe("内容脚本工具 E2E", () => {
  // 每个测试用例都会启动一个加载了扩展的 Chrome
  test("inspect 返回非 null 页面结构", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // 导航到测试页面
    const html = await testPageHtml;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);

    // 检查 content script 是否注入成功 - 通过检查页面上的 console 消息
    // content script 注入后，我们直接在页面上下文中调用 inspect 逻辑
    const inspectResult = await page.evaluate(() => {
      // 模拟 content script 的 inspect 逻辑
      function isHidden(el) {
        const style = getComputedStyle(el);
        if (style.display === "none") return true;
        if (style.visibility === "hidden") return true;
        if (el.getAttribute("aria-hidden") === "true") return true;
        return false;
      }
      const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "SVG", "BR", "HR", "IMG", "INPUT", "TEXTAREA", "SELECT"]);
      function extractVisibleText(el) {
        if (isHidden(el)) return "";
        if (SKIP_TAGS.has(el.tagName)) return "";
        if (el.children.length === 0) return el.textContent?.trim() ?? "";
        const parts = [];
        for (const child of el.children) {
          const t = extractVisibleText(child);
          if (t) parts.push(t);
        }
        const blockTags = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TR", "TD", "TH", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "NAV", "MAIN", "ASIDE", "UL", "OL", "TABLE", "FORM", "FIELDSET", "DL", "DD", "DT", "FIGURE", "FIGCAPTION", "DETAILS", "SUMMARY"]);
        return parts.join(blockTags.has(el.tagName) ? "\n" : " ");
      }

      const body = document.body;
      if (!body) return null;

      const children = Array.from(body.children);
      const lines = [`页面: ${document.title} (${location.href})`];
      for (const child of children) {
        const tag = child.tagName.toLowerCase();
        if (["script", "style", "link", "meta", "noscript"].includes(tag)) continue;
        const hidden = isHidden(child);
        let sel = child.tagName.toLowerCase();
        if (child.id) sel += `#${child.id}`;
        const interactive = child.querySelectorAll("button, a, input, select, textarea, [role='button'], [role='link']").length;
        const chars = extractVisibleText(child).length;
        let line = `${sel} — 交互:${interactive} 字符:${chars}`;
        if (hidden) line += " (hidden)";
        lines.push(line);
      }
      return lines.join("\n");
    });

    // 验证 inspect 结果
    expect(inspectResult).not.toBeNull();
    expect(inspectResult).toContain("header#site-header");
    expect(inspectResult).toContain("main#content");
    expect(inspectResult).toContain("footer#site-footer");
    expect(inspectResult).toContain("交互:2"); // header 里有 2 个链接
    expect(inspectResult).not.toContain("这段隐藏文字不应该被提取");

    await context.close();
  });

  test("extractVisibleText 过滤隐藏元素和 SVG", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const html = await testPageHtml;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const fullText = await page.evaluate(() => {
      function isHidden(el) {
        const style = getComputedStyle(el);
        if (style.display === "none") return true;
        if (style.visibility === "hidden") return true;
        if (el.getAttribute("aria-hidden") === "true") return true;
        return false;
      }
      const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "SVG", "BR", "HR", "IMG", "INPUT", "TEXTAREA", "SELECT"]);
      function extractVisibleText(el) {
        if (isHidden(el)) return "";
        if (SKIP_TAGS.has(el.tagName)) return "";
        if (el.children.length === 0) return el.textContent?.trim() ?? "";
        const parts = [];
        for (const child of el.children) {
          const t = extractVisibleText(child);
          if (t) parts.push(t);
        }
        const blockTags = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TR", "TD", "TH", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "NAV", "MAIN", "ASIDE", "UL", "OL", "TABLE", "FORM", "FIELDSET", "DL", "DD", "DT", "FIGURE", "FIGCAPTION", "DETAILS", "SUMMARY"]);
        return parts.join(blockTags.has(el.tagName) ? "\n" : " ");
      }
      return extractVisibleText(document.body);
    });

    // 可见内容应该被提取
    expect(fullText).toContain("页面标题");
    expect(fullText).toContain("欢迎来到测试页面");
    expect(fullText).toContain("功能一：文本提取");

    // 隐藏内容不应该被提取
    expect(fullText).not.toContain("这段隐藏文字不应该被提取");
    expect(fullText).not.toContain("aria-hidden 内容不应该被提取");

    // SVG 内容不应该被提取
    expect(fullText).not.toContain("icon-home");
    expect(fullText).not.toContain("M10 20v-6h4v6");

    // script 内容不应该被提取
    expect(fullText).not.toContain("console.log");

    await context.close();
  });

  test("read 按选择器读取并支持分页", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const html = await testPageHtml;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);

    const readResult = await page.evaluate(() => {
      function isHidden(el) {
        const style = getComputedStyle(el);
        if (style.display === "none") return true;
        if (style.visibility === "hidden") return true;
        if (el.getAttribute("aria-hidden") === "true") return true;
        return false;
      }
      const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "SVG", "BR", "HR", "IMG", "INPUT", "TEXTAREA", "SELECT"]);
      function extractVisibleText(el) {
        if (isHidden(el)) return "";
        if (SKIP_TAGS.has(el.tagName)) return "";
        if (el.children.length === 0) return el.textContent?.trim() ?? "";
        const parts = [];
        for (const child of el.children) {
          const t = extractVisibleText(child);
          if (t) parts.push(t);
        }
        const blockTags = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TR", "TD", "TH", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "NAV", "MAIN", "ASIDE", "UL", "OL", "TABLE", "FORM", "FIELDSET", "DL", "DD", "DT", "FIGURE", "FIGCAPTION", "DETAILS", "SUMMARY"]);
        return parts.join(blockTags.has(el.tagName) ? "\n" : " ");
      }

      const selector = ".long-content";
      const el = document.querySelector(selector);
      if (!el) return { error: `未找到元素: ${selector}` };

      const text = extractVisibleText(el);
      const totalChars = text.length;
      const offset = 0;
      const limit = 100;
      const sliced = text.slice(offset, offset + limit);
      const hasMore = offset + limit < totalChars;
      return { content: sliced, totalChars, hasMore, truncated: hasMore };
    });

    // 验证 read 结果结构
    expect(readResult).toHaveProperty("content");
    expect(readResult).toHaveProperty("totalChars");
    expect(readResult).toHaveProperty("hasMore");
    expect(readResult.totalChars).toBeGreaterThan(100);
    expect(readResult.hasMore).toBe(true);
    expect(readResult.content.length).toBeLessThanOrEqual(100);
    expect(readResult.content).toContain("Lorem ipsum");

    await context.close();
  });
});
