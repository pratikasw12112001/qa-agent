/**
 * Playwright abstraction — uses bundled playwright on Windows dev,
 * npm playwright on Linux CI (GitHub Actions).
 */

let _pw;

export async function getPlaywright() {
  if (_pw) return _pw;
  try {
    _pw = await import("playwright");
  } catch {
    // Windows local dev: use bundled playwright-go
    _pw = await import(
      "file:///C:/Users/Pratik%20Aswani/AppData/Local/ms-playwright-go/1.50.1/package/index.mjs"
    );
  }
  return _pw;
}

export async function launchBrowser(headless = true) {
  const pw = await getPlaywright();
  const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const fs = await import("fs");

  const opts = { headless, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (fs.existsSync(CHROME)) opts.executablePath = CHROME;

  return pw.chromium.launch(opts);
}

export async function newContext(browser, sessionPath, viewport = { width: 1440, height: 900 }) {
  const fs = await import("fs");
  const opts = { viewport, deviceScaleFactor: 2 };
  if (sessionPath && fs.existsSync(sessionPath)) {
    opts.storageState = sessionPath;
  }
  return browser.newContext(opts);
}
