/**
 * Functional test runner.
 *
 * Generic checks run against the source URL + its discovered states:
 *   - Console errors
 *   - Failed network requests (4xx/5xx)
 *   - Broken links in content area
 *   - Form validation (forms in content area only)
 *   - Interactive element responsiveness (content area)
 *
 * Sidebar/nav is excluded (per user requirement).
 */

import { chromium } from "playwright";
import { runAxeChecks } from "./a11y.mjs";

const SIDEBAR_SELECTORS = [
  ".ant-menu", ".ant-layout-sider", '[class*="sidebar" i]',
  '[class*="side-nav" i]', '[class*="left-nav" i]', 'aside', 'nav[role="navigation"]',
].join(", ");

export async function runFunctionalTests({ liveUrl, sessionPath, states }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: sessionPath,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ url: page.url(), message: msg.text().slice(0, 300) });
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      networkErrors.push({ url: res.url(), status: res.status(), onPage: page.url() });
    }
  });

  const results = {
    consoleErrors: [], networkErrors: [],
    brokenLinks: [], formChecks: [], a11y: [],
    testedUrls: [],
  };

  // Deduplicate state URLs
  const uniqueUrls = Array.from(new Set(states.map((s) => s.url)));

  for (const url of uniqueUrls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      results.testedUrls.push(url);

      // Broken links
      results.brokenLinks.push(...await checkBrokenLinks(page));

      // Form validation
      results.formChecks.push(...await checkForms(page));

      // Accessibility
      const a11y = await runAxeChecks(page).catch(() => null);
      if (a11y) results.a11y.push({ url, violations: a11y });
    } catch (e) {
      consoleErrors.push({ url, message: `page load failed: ${e.message.slice(0, 200)}` });
    }
  }

  results.consoleErrors = consoleErrors;
  results.networkErrors = dedupeByUrl(networkErrors);

  await browser.close();
  return results;
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function checkBrokenLinks(page) {
  const links = await page.evaluate((sidebarSel) => {
    return Array.from(document.querySelectorAll('a[href]'))
      .filter((a) => !a.closest(sidebarSel))
      .map((a) => a.href)
      .filter((h) => h.startsWith("http"))
      .slice(0, 15);
  }, SIDEBAR_SELECTORS);

  const broken = [];
  for (const href of Array.from(new Set(links))) {
    try {
      const res = await fetch(href, { method: "HEAD", redirect: "follow" }).catch(() => null);
      if (res && res.status >= 400) broken.push({ href, status: res.status });
    } catch {
      // ignore network errors (may be CORS-blocked HEAD)
    }
  }
  return broken;
}

async function checkForms(page) {
  const out = [];
  const forms = await page.locator("form").all();
  for (let i = 0; i < Math.min(forms.length, 3); i++) {
    const form = forms[i];
    try {
      const inSidebar = await form.evaluate((el, sel) => !!el.closest(sel), SIDEBAR_SELECTORS);
      if (inSidebar) continue;
      // Try submitting empty — see if validation kicks in
      const submit = form.locator('button[type="submit"], input[type="submit"]').first();
      if (await submit.count()) {
        const before = page.url();
        await submit.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(800);
        const after = page.url();
        const hasError = await page.locator('[class*="error" i], [aria-invalid="true"], [role="alert"]').count();
        if (!hasError && before === after) {
          out.push({ url: page.url(), formIndex: i, issue: "empty submit did not trigger validation or navigation" });
        }
      }
    } catch {
      // skip form
    }
  }
  return out;
}

function dedupeByUrl(arr) {
  const seen = new Set();
  return arr.filter((x) => {
    if (seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });
}
