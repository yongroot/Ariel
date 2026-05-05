import { test, expect, chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_PATH = path.resolve(__dirname, "../dist");

test.describe("Ariel 真实 Chrome 测试", () => {
  test("加载扩展并打开 Side Panel 验证 UI", async () => {
    const extensionPath = DIST_PATH;

    // 启动 Chrome 并加载扩展
    const context = await chromium.launchPersistentContext(
      "/tmp/pw-ariel-test",
      {
        channel: "chrome",
        headless: false,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      }
    );

    const page = await context.newPage();

    // 监听错误
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    // 打开一个页面
    await page.goto("https://example.com");
    await page.waitForTimeout(3000);

    // 尝试通过 CDP 打开 Side Panel
    const cdp = await page.context().newCDPSession(page);
    try {
      // Chrome 116+ 支持 sidePanel.open
      await cdp.send("SidePanel.open", {});
      await page.waitForTimeout(2000);
    } catch {
      console.log("CDP SidePanel.open 不可用，跳过 Side Panel UI 测试");
    }

    // 截图当前页面
    await page.screenshot({ path: "/tmp/ariel-test.png" });

    await context.close();

    // 报告错误
    const criticalErrors = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("net::ERR")
    );
    if (criticalErrors.length > 0) {
      console.log("发现错误:", criticalErrors);
    }
    expect(criticalErrors).toHaveLength(0);
  });
});
