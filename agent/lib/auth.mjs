/**
 * Login + session capture.
 *
 * Flow:
 *  1. Launch browser, go to source URL.
 *  2. If redirected to login (URL contains "login" OR password field present) → fill and submit.
 *  3. After login → force-navigate back to source URL.
 *  4. Wait for the SPA to fully hydrate (networkidle + extra settle time).
 *  5. Verify we are no longer on login. Save storage state.
 *
 * Credentials come from env (LOGIN_EMAIL / LOGIN_PASSWORD) — never from the user form.
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export async function loginAndCaptureSession({ liveUrl, sessionPath }) {
  const email    = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;
  if (!email || !password) throw new Error("LOGIN_EMAIL / LOGIN_PASSWORD missing in env");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await context.newPage();

  console.log(`   → navigating to ${liveUrl}`);
  await page.goto(liveUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

  // Detect login page
  const needsLogin = await detectLoginPage(page);
  if (needsLogin) {
    console.log(`   → login page detected, submitting credentials`);
    await performLogin(page, email, password);
    await waitForPostLogin(page);

    // Force-navigate back to source URL
    console.log(`   → navigating back to source URL: ${liveUrl}`);
    await page.goto(liveUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Give the SPA extra time to fully hydrate auth state
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);   // extra settle for SPA auth context
  }

  // Verify we are authenticated
  const stillLogin = await detectLoginPage(page);
  if (stillLogin) {
    await browser.close();
    throw new Error("Login failed — still on login page after submission");
  }

  // Save cookies + localStorage + sessionStorage
  mkdirSync(dirname(sessionPath), { recursive: true });
  const state = await context.storageState();
  writeFileSync(sessionPath, JSON.stringify(state, null, 2));

  await browser.close();
  console.log(`   → session saved (${state.cookies.length} cookies, ${Object.keys(state.origins?.[0]?.localStorage ?? {}).length} localStorage keys)`);
}

/** Re-use exported helpers so explorer can call login if session doesn't work. */
export async function performLoginOnPage(page, email, password) {
  await performLogin(page, email, password);
  await waitForPostLogin(page);
}

export { detectLoginPage };

// ─── internals ───────────────────────────────────────────────────────────────

async function detectLoginPage(page) {
  const url = page.url().toLowerCase();
  if (url.includes("/login") || url.includes("/signin") || url.includes("/auth")) return true;
  const hasPasswordField = await page.locator('input[type="password"]').count();
  return hasPasswordField > 0;
}

async function performLogin(page, email, password) {
  const emailSelectors = [
    'input[type="email"]', 'input[name="email"]',
    'input[id*="email" i]', 'input[placeholder*="email" i]',
    'input[name="username"]',
  ];
  const passwordSelectors = ['input[type="password"]', 'input[name="password"]'];

  const emailInput = await findFirst(page, emailSelectors);
  if (!emailInput) throw new Error("Could not find email/username input");
  await emailInput.fill(email);

  const pwdInput = await findFirst(page, passwordSelectors);
  if (!pwdInput) throw new Error("Could not find password input");
  await pwdInput.fill(password);

  await pwdInput.press("Enter");

  try {
    await page.waitForURL(
      (u) => !u.toString().toLowerCase().match(/\/(login|signin|auth)/),
      { timeout: 10000 }
    );
  } catch {
    const btn = await findFirst(page, [
      'button[type="submit"]', 'button:has-text("Sign in")',
      'button:has-text("Log in")', 'button:has-text("Login")',
      'input[type="submit"]',
    ]);
    if (btn) await btn.click();
  }
}

async function findFirst(page, selectors) {
  for (const s of selectors) {
    const loc = page.locator(s).first();
    if (await loc.count()) return loc;
  }
  return null;
}

async function waitForPostLogin(page) {
  try {
    await page.waitForURL(
      (u) => !u.toString().toLowerCase().match(/\/(login|signin|auth)/),
      { timeout: 15000 }
    );
  } catch {
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  }
  // Extra settle time for SPA to write auth tokens to storage
  await page.waitForTimeout(1500);
}
