/**
 * Auth module — login to the live app and save/reuse session state.
 * Reuses saved session if it exists and is less than SESSION_MAX_AGE_MS old.
 */

import { launchBrowser, newContext } from "./browser.mjs";
import { writeFileSync, existsSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { mkdirSync } from "fs";

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

export async function ensureSession(config) {
  const sessionPath = config.sessionPath;

  if (existsSync(sessionPath)) {
    const age = Date.now() - statSync(sessionPath).mtimeMs;
    if (age < SESSION_MAX_AGE_MS) {
      console.log(`  Auth: reusing saved session (${Math.round(age / 60000)}m old)`);
      return sessionPath;
    }
    console.log("  Auth: session expired, re-logging in…");
  } else {
    console.log("  Auth: no session found, logging in…");
  }

  await login(config);
  return sessionPath;
}

async function login(config) {
  const browser = await launchBrowser(true);
  try {
    const context = await newContext(browser, null);
    const page = await context.newPage();

    await page.goto(config.loginUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);

    // Fill email
    const emailSel = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[autocomplete="email"]',
    ];
    for (const sel of emailSel) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, config.loginEmail);
        break;
      }
    }

    // Fill password
    const passSel = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="password" i]',
    ];
    for (const sel of passSel) {
      if ((await page.locator(sel).count()) > 0) {
        await page.fill(sel, config.loginPassword);
        break;
      }
    }

    // Submit
    const submitSel = [
      'button[type="submit"]',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'button:has-text("Login")',
      'input[type="submit"]',
    ];
    for (const sel of submitSel) {
      if ((await page.locator(sel).count()) > 0) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {}),
          page.click(sel),
        ]);
        break;
      }
    }

    await page.waitForTimeout(2000);

    // Save session
    mkdirSync(dirname(resolve(config.sessionPath)), { recursive: true });
    await context.storageState({ path: config.sessionPath });
    console.log(`  Auth: logged in, session saved to ${config.sessionPath}`);
  } finally {
    await browser.close();
  }
}
