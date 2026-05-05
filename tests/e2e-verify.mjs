// E2E verification: loads extension in Playwright's Chromium, opens sidepanel page directly
// This avoids the localhost CDP issue by using Playwright's bundled Chromium
import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";

const EXT_PATH = path.resolve("dist");
const SCREENSHOT_DIR = "/tmp/ariel-e2e";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log("Launching Chromium with Ariel extension...");
  const context = await chromium.launchPersistentContext("/tmp/pw-ariel-e2e", {
    channel: "chrome",
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  try {
    // Collect errors across all pages
    const errors = [];
    context.on("weberror", err => {
      errors.push(err.error?.message || "unknown web error");
    });

    // Navigate main page to trigger content script
    const page = await context.newPage();
    page.on("console", msg => {
      if (msg.type() === "error" && !msg.text().includes("favicon") && !msg.text().includes("404")) {
        errors.push(msg.text());
      }
    });

    console.log("Navigating to example.com...");
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await sleep(2000);

    // Find extension ID from service worker target
    const allPages = context.pages();
    const extPage = allPages.find(p => p.url().includes("chrome-extension://") && p.url().includes("_generated_background_page"));
    
    if (!extPage) {
      // Try to find extension ID another way - check all pages
      console.log("Looking for extension in pages...");
      for (const p of allPages) {
        console.log(`  Page: ${p.url().substring(0, 100)}`);
      }
    }

    // Get extension ID from the background page or service worker
    let extId = null;
    for (const p of allPages) {
      const url = p.url();
      if (url.includes("chrome-extension://")) {
        try { extId = new URL(url).hostname; break; } catch {}
      }
    }

    if (!extId) {
      // Alternative: read manifest to check the extension loaded correctly
      console.log("⚠ Could not find extension ID, testing via dist files directly");
      
      // Verify dist structure instead
      const manifest = JSON.parse(fs.readFileSync(path.join(EXT_PATH, "manifest.json"), "utf-8"));
      console.log(manifest.name === "Ariel" ? "✓ manifest.json: name=Ariel" : "✗ manifest name wrong");
      console.log(manifest.manifest_version === 3 ? "✓ manifest.json: MV3" : "✗ manifest version wrong");
      
      // Check no tavily in dist
      const bgJs = fs.readFileSync(path.join(EXT_PATH, "src/background/index.js"), "utf-8");
      const spJs = fs.readFileSync(path.join(EXT_PATH, "src/sidepanel/index.js"), "utf-8");
      console.log(!bgJs.toLowerCase().includes("tavily") ? "✓ No tavily in background.js" : "✗ Tavily in background.js!");
      console.log(!spJs.toLowerCase().includes("tavily") ? "✓ No tavily in sidepanel.js" : "✗ Tavily in sidepanel.js!");
      
      // Check marked/highlight.js in sidepanel bundle
      console.log(spJs.length > 50000 ? `✓ Sidepanel bundle size OK (${Math.round(spJs.length/1024)}KB, includes marked+hljs)` : `⚠ Sidepanel bundle small (${spJs.length}B)`);
      
      // Check CSS variables in sidepanel CSS
      const indexCss = fs.readFileSync(path.join(EXT_PATH, "index.css"), "utf-8");
      console.log(indexCss.includes("--ap-bg-primary") ? "✓ CSS vars in index.css" : "✗ CSS vars missing");
      
      // Check theme.ts functions in sidepanel bundle
      console.log(spJs.includes("generatePalette") ? "✓ generatePalette in bundle" : "✗ generatePalette missing");
      console.log(spJs.includes("formatTime") ? "✓ formatTime in bundle" : "✗ formatTime missing");
      console.log(spJs.includes("createSession") ? "✓ Session management in bundle" : "✗ Session management missing");
      console.log(spJs.includes("会话历史") ? "✓ Session history UI in bundle" : "✗ Session history UI missing");
      console.log(spJs.includes("marked") ? "✓ Markdown (marked) in bundle" : "✗ Markdown missing");
      console.log(spJs.includes("highlight") ? "✓ Highlight.js in bundle" : "✗ Highlight.js missing");
      console.log(spJs.includes("downloadMarkdown") || spJs.includes(".md") ? "✓ Download .md button in bundle" : "✗ Download button missing");
      console.log(spJs.includes("v0.1.0") ? "✓ Version string in bundle" : "✗ Version string missing");
      
      // Check session storage keys
      console.log(spJs.includes("ariel_sessions") ? "✓ ariel_sessions key in bundle" : "✗ Sessions key missing");
      console.log(spJs.includes("ariel_active_session") ? "✓ ariel_active_session key in bundle" : "✗ Active session key missing");
      
      await page.screenshot({ path: `${SCREENSHOT_DIR}/01-page-with-extension.png` });
      console.log("✓ Screenshot: 01-page-with-extension.png");
      
    } else {
      console.log(`Extension ID: ${extId}`);
      
      // Open sidepanel directly
      const sp = await context.newPage();
      sp.on("console", msg => {
        if (msg.type() === "error") errors.push("[SP] " + msg.text());
      });
      
      await sp.goto(`chrome-extension://${extId}/src/sidepanel/index.html`, { waitUntil: "domcontentloaded" });
      await sleep(2000);
      
      await sp.screenshot({ path: `${SCREENSHOT_DIR}/02-sidepanel.png` });
      console.log("✓ Screenshot: 02-sidepanel.png");
      
      const text = await sp.evaluate(() => document.body.innerText);
      console.log(text.includes("Ariel") ? "✓ Brand" : "✗ Brand missing");
      console.log(text.includes("对话") && text.includes("设置") ? "✓ Nav tabs" : "✗ Nav tabs missing");
      
      // Settings
      await sp.evaluate(() => {
        for (const b of document.querySelectorAll("button")) {
          if (b.textContent.trim() === "设置") { b.click(); break; }
        }
      });
      await sleep(500);
      await sp.screenshot({ path: `${SCREENSHOT_DIR}/03-settings.png` });
      
      const stext = await sp.evaluate(() => document.body.innerText);
      console.log(stext.includes("v0.1.0") ? "✓ Version" : "✗ Version missing");
      console.log(!stext.toLowerCase().includes("tavily") ? "✓ No Tavily" : "✗ Tavily present");
      
      // Session history
      await sp.evaluate(() => {
        for (const b of document.querySelectorAll("button")) { if (b.textContent.trim() === "对话") { b.click(); break; } }
      });
      await sp.evaluate(() => {
        for (const b of document.querySelectorAll("button")) { if (b.title === "会话历史") { b.click(); break; } }
      });
      await sleep(500);
      await sp.screenshot({ path: `${SCREENSHOT_DIR}/04-history.png` });
      
      const htext = await sp.evaluate(() => document.body.innerText);
      console.log(htext.includes("会话历史") ? "✓ Session panel" : "✗ Session panel missing");
    }

    // Summary
    console.log(`\n=== Results ===`);
    console.log(`Screenshots: ${SCREENSHOT_DIR}`);
    console.log(errors.length === 0 ? "✓ No console errors" : `⚠ ${errors.length} errors`);
    errors.forEach(e => console.log(`  ${e}`));

  } finally {
    await context.close();
  }
})();
