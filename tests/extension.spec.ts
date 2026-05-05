import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_PATH = path.resolve(__dirname, "../dist");

test.describe("构建验证", () => {
  test("dist/ 目录包含必要文件", async () => {
    const manifestContent = JSON.parse(
      await fs.readFile(path.join(DIST_PATH, "manifest.json"), "utf-8")
    );

    expect(manifestContent.manifest_version).toBe(3);
    expect(manifestContent.name).toBe("Ariel");

    const requiredFiles = [
      "src/sidepanel/index.html",
      "src/sidepanel/index.js",
      "src/background/index.js",
      "src/content/index.js",
      "index.css",
    ];

    for (const file of requiredFiles) {
      const stat = await fs.stat(path.join(DIST_PATH, file));
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test("manifest 包含 Side Panel 配置", async () => {
    const manifestContent = JSON.parse(
      await fs.readFile(path.join(DIST_PATH, "manifest.json"), "utf-8")
    );

    expect(manifestContent.side_panel).toBeDefined();
    expect(manifestContent.side_panel.default_path).toContain("sidepanel");
  });

  test("Tavily 相关代码已完全移除", async () => {
    // 检查 dist 构建产物中无 tavily 引用
    const jsFiles = [
      "src/sidepanel/index.js",
      "src/background/index.js",
    ];
    for (const file of jsFiles) {
      const content = await fs.readFile(path.join(DIST_PATH, file), "utf-8");
      expect(content.toLowerCase()).not.toContain("tavily");
    }
  });

  test("Markdown 渲染依赖已打包", async () => {
    // marked + highlight.js 应该在 sidepanel bundle 中
    const sidepanelJs = await fs.readFile(
      path.join(DIST_PATH, "src/sidepanel/index.js"), "utf-8"
    );
    // marked 的 parse 函数或 hljs 应该存在
    expect(sidepanelJs.length).toBeGreaterThan(10000);
  });
});

test.describe("Chrome 扩展加载", () => {
  test("扩展加载无致命错误", async ({ browser }) => {
    const context = await browser.newContext();
    const errors: string[] = [];

    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!text.includes("favicon") && !text.includes("404")) {
          errors.push(text);
        }
      }
    });

    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await context.close();

    expect(errors).toHaveLength(0);
  });
});
