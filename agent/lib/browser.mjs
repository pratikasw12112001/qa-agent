/**
 * Playwright abstraction.
 * In CI: uses npm-installed playwright package.
 * On Windows dev: falls back to ms-playwright-go bundled binary.
 */

import { existsSync } from "fs";

let _pw;

export async function getPlaywright() {
  if (_pw) return _pw;
  try {
    _pw = (await import("playwright"));
    return _pw;
  } catch {
    // Windows local dev fallback
    const devPath = "C:/Users/Pratik Aswani/AppData/Local/ms-playwright-go/1.50.1/package/index.mjs";
    if (existsSync(devPath)) {
      _pw = await import("file:///" + devPath);
      return _pw;
    }
    throw new Error("playwright package not found. Run: npm install playwright");
  }
}

export async function launchBrowser(headless = true) {
  const pw = await getPlaywright();
  const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const opts = { headless, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (existsSync(CHROME)) opts.executablePath = CHROME;
  return pw.chromium.launch(opts);
}

export async function newContext(browser, sessionPath, viewport = { width: 1440, height: 900 }) {
  const opts = { viewport, deviceScaleFactor: 2 };
  if (sessionPath && existsSync(sessionPath)) {
    opts.storageState = sessionPath;
  }
  return browser.newContext(opts);
}
