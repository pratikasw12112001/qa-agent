/**
 * Smart state-graph exploration — Ant Design aware.
 *
 * Starts at the user-provided source URL (after login).
 * Captures the root state first, then BFS-clicks interactive elements
 * in the MAIN content area (sidebar excluded).
 *
 * Session resilience: if storageState doesn't restore auth (SPA shows login),
 * re-logs in automatically before starting.
 */

import { chromium } from "playwright";
import { createHash } from "crypto";
import { detectLoginPage, performLoginOnPage } from "./auth.mjs";

// ── Sidebar selectors — never click anything inside these ─────────────────────
const SIDEBAR_SELECTORS = [
  ".ant-menu", ".ant-layout-sider", ".ant-menu-root",
  '[class*="sidebar" i]', '[class*="side-bar" i]',
  '[class*="side-nav" i]', '[class*="sidenav" i]',
  '[class*="left-menu" i]', '[class*="leftmenu" i]',
  '[class*="left-nav" i]',
  'nav[class*="side" i]', 'aside',
  'nav[role="navigation"]',
].join(", ");

// ── Text we must never click ──────────────────────────────────────────────────
const BLOCKED_TEXT = [
  "log out", "logout", "sign out", "signout",
  "delete account", "delete", "remove account",
  "forgot password", "reset password",
  "privacy policy", "terms", "terms & conditions", "terms of service",
  "cookie policy", "legal",
  "register", "sign up", "create account",
  "go back to login", "back to login",
];

// ── URL patterns that mean we've left the target app ─────────────────────────
const BLOCKED_URL_RE = /\/(login|signin|auth|logout|terms|privacy|legal|cookie)/i;

export async function exploreStates({
  liveUrl, sessionPath, maxStates = 30, maxDepth = 3, waitAfterClickMs = 1200,
}) {
  const email    = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: sessionPath,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // ── Navigate to source URL and ensure we're authenticated ────────────────
  console.log(`   → opening source URL: ${liveUrl}`);
  await page.goto(liveUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(2000);  // let SPA fully hydrate

  if (await detectLoginPage(page)) {
    console.log(`   → session not recognised — re-logging in`);
    await performLoginOnPage(page, email, password);
    console.log(`   → navigating to source URL: ${liveUrl}`);
    await page.goto(liveUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if (await detectLoginPage(page)) throw new Error("Explorer re-login failed");
    console.log(`   → authenticated, url: ${page.url()}`);
  }

  const states      = [];
  const seenHashes  = new Set();
  const clickedKeys = new Set();  // global dedup of (stateHash, elementText) pairs

  // ── Capture root state ───────────────────────────────────────────────────
  const root = await captureState(page, {
    id: "s0", parent: null, triggerDesc: "initial load",
    url: page.url(), depth: 0,
  });
  states.push(root);
  seenHashes.add(root.hash);
  console.log(`   → root state captured: ${root.url}`);

  const queue = [{ stateId: root.id, depth: 0 }];
  let stateCounter = 1;

  while (queue.length && states.length < maxStates) {
    const { stateId, depth } = queue.shift();
    if (depth >= maxDepth) continue;

    const parent = states.find((s) => s.id === stateId);
    if (!parent || BLOCKED_URL_RE.test(parent.url)) continue;

    try {
      await page.goto(parent.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);

      // Session guard
      if (await detectLoginPage(page)) {
        console.log(`   → mid-run session expired, re-logging in`);
        await performLoginOnPage(page, email, password);
        await page.goto(parent.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    } catch (e) {
      console.warn(`   ⚠ failed to re-open ${parent.url}: ${e.message.slice(0, 60)}`);
      continue;
    }

    // ── Reveal hover-only row action buttons ─────────────────────────────────
    // Ant Design (and many other frameworks) hide per-row action buttons via CSS
    // until the user hovers. Force them visible so the selector scan can find them.
    await page.addStyleTag({
      content: `
        .ant-table-row td .ant-btn, .ant-table-row td .ant-space .ant-btn,
        .ant-table-row td .ant-dropdown-trigger, [data-row-key] td .ant-btn,
        .ant-table-cell .ant-btn-icon-only, .ant-table-row td [role="button"],
        tr td .ant-space, tr td .ant-space-item
        { opacity:1!important; visibility:visible!important; pointer-events:auto!important; }
      `,
    }).catch(() => {});
    // Hover first table row so any JS-based hover reveals also fire
    await page.locator('[data-row-key], .ant-table-row').first().hover({ force: true }).catch(() => {});
    await page.waitForTimeout(300);

    const clickables = await collectClickables(page);
    console.log(`   → state ${parent.id}: ${clickables.length} clickable candidates`);

    for (const el of clickables) {
      if (states.length >= maxStates) break;

      // Global dedup: don't repeat (parent-url, element-text) combination
      const globalKey = `${parent.url}::${el.text}`;
      if (clickedKeys.has(globalKey)) continue;
      clickedKeys.add(globalKey);

      const beforeUrl  = page.url();
      const beforeHash = await domHash(page);

      try {
        const locator = page.locator(el.selector).first();
        if (!(await locator.count())) continue;
        if (!(await locator.isVisible().catch(() => false))) continue;

        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await locator.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(waitAfterClickMs);

        const afterUrl  = page.url();
        const afterHash = await domHash(page);

        // Bail if we landed on a blocked URL
        if (BLOCKED_URL_RE.test(afterUrl)) {
          await page.goto(parent.url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
          continue;
        }

        const urlChanged = afterUrl !== beforeUrl;
        const domChanged = afterHash !== beforeHash;
        if (!urlChanged && !domChanged) continue;

        if (seenHashes.has(afterHash)) {
          if (urlChanged) {
            await page.goto(parent.url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
            await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
          } else {
            await dismissOverlay(page);
          }
          continue;
        }

        const newState = await captureState(page, {
          id: `s${stateCounter++}`, parent: parent.id,
          triggerDesc: `click "${truncate(el.text, 40)}"`,
          url: afterUrl, depth: depth + 1,
        });
        states.push(newState);
        seenHashes.add(newState.hash);
        queue.push({ stateId: newState.id, depth: depth + 1 });
        console.log(`     + ${newState.id} via click "${truncate(el.text, 40)}" (${urlChanged ? "nav" : "overlay"})`);

        if (urlChanged) {
          await page.goto(parent.url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        } else {
          await dismissOverlay(page);
        }
      } catch {
        // swallow, try next
      }
    }
  }

  await browser.close();
  console.log(`   → ${states.length} unique state(s) captured`);
  return states;
}

// ─── collectClickables ──────────────────────────────────────────────────────
// Broad set of selectors, Ant Design aware.

async function collectClickables(page) {
  return await page.evaluate(({ sidebarSel, blocked }) => {
    function isInSidebar(el) { return !!el.closest(sidebarSel); }

    // All candidate selectors — ordered from most to least specific
    const SELECTORS = [
      // Standard interactive
      'button:not([disabled])',
      'a[href]:not([href^="mailto"]):not([href^="tel"])',
      // ARIA roles
      '[role="button"]:not([disabled])',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="row"]',
      // Ant Design components
      '.ant-btn',
      '.ant-tabs-tab',
      '.ant-table-row',
      '.ant-select:not(.ant-select-disabled)',
      '.ant-picker',
      '.ant-dropdown-trigger',
      '.ant-card[data-toggle]',
      '.ant-collapse-header',
      '.ant-radio-button-wrapper',
      '.ant-checkbox-wrapper',
      // Generic patterns
      '[class*="filter" i]:not(input)',
      '[class*="search" i] button',
      '[class*="create" i][class*="btn" i]',
      '[class*="add" i][class*="btn" i]',
      '[class*="edit" i][class*="btn" i]',
      '[class*="row" i][class*="clickable" i]',
      '[data-row-key]',
      // Inputs that open pickers
      'input[type="button"]',
      'input[type="submit"]',
      // Row action buttons (icon-only or text buttons inside table cells)
      'td .ant-btn',
      'td .ant-dropdown-trigger',
      '.ant-table-cell .ant-btn',
      '.ant-table-cell .ant-btn-icon-only',
      'td .ant-space .ant-btn',
      // Icon-only buttons (ellipsis / more / kebab menus)
      '[aria-label*="more" i]',
      '[aria-label*="ellipsis" i]',
      '[title*="more" i]',
      '[title*="action" i]',
      // Generic table cell interactive elements
      'td button',
      'td [role="button"]',
    ];

    const seen    = new Set();
    const seenTxt = new Set();
    const out     = [];

    for (const sel of SELECTORS) {
      let els;
      try { els = Array.from(document.querySelectorAll(sel)); } catch { continue; }

      for (const el of els) {
        if (isInSidebar(el)) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight + 400) continue;

        const text     = (el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().slice(0, 60);
        const textNorm = text.toLowerCase();

        if (blocked.some((b) => textNorm.includes(b))) continue;

        // Stable selector
        let selector;
        if (el.id) {
          selector = `#${CSS.escape(el.id)}`;
        } else if (text && text.length > 1 && text.length < 50) {
          selector = `${el.tagName.toLowerCase()}:has-text("${text.replace(/"/g, '\\"').slice(0, 50)}")`;
        } else {
          const cls = (typeof el.className === "string" && el.className.trim())
            ? "." + el.className.trim().split(/\s+/).slice(0, 2).map(CSS.escape).join(".")
            : "";
          selector = `${el.tagName.toLowerCase()}${cls}`;
        }

        const key = textNorm || selector;
        if (seenTxt.has(key) || seen.has(selector)) continue;
        seenTxt.add(key);
        seen.add(selector);

        out.push({ selector, text: text || `[${el.tagName.toLowerCase()}]`, tag: el.tagName.toLowerCase() });
        if (out.length >= 45) return out;  // cap per state at 45
      }
    }
    return out;
  }, { sidebarSel: SIDEBAR_SELECTORS, blocked: BLOCKED_TEXT });
}

// ─── captureState ────────────────────────────────────────────────────────────

async function captureState(page, meta) {
  // Wait briefly for any pending renders
  await page.waitForTimeout(400);
  const screenshot  = await page.screenshot({ fullPage: false, type: "png" });
  const dom         = await page.evaluate(extractDom);
  const hash = createHash("sha256")
    .update(meta.url)
    .update(dom.texts.join("|").slice(0, 4000))
    .update(JSON.stringify(dom.structure))
    .digest("hex");
  return {
    id: meta.id, parent: meta.parent, triggerDesc: meta.triggerDesc,
    url: meta.url, depth: meta.depth,
    screenshot: screenshot.toString("base64"),
    textContent: dom.texts,
    structure: dom.structure,
    hash,
  };
}

function extractDom() {
  const texts = [];
  document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,a,button,label,td,th,li,.ant-table-cell")
    .forEach((el) => {
      const t = (el.innerText || "").trim();
      if (t && t.length > 1 && t.length < 200) texts.push(t);
    });
  const structure = {
    buttons:  document.querySelectorAll('button, .ant-btn, [role="button"]').length,
    inputs:   document.querySelectorAll("input, textarea, select, .ant-select, .ant-picker").length,
    images:   document.querySelectorAll("img").length,
    links:    document.querySelectorAll("a[href]").length,
    tables:   document.querySelectorAll("table, .ant-table").length,
    headings: document.querySelectorAll("h1,h2,h3,h4").length,
    modals:   document.querySelectorAll('[role="dialog"], .ant-modal, [class*="modal" i]').length,
    total:    document.querySelectorAll("*").length,
  };
  return { texts: Array.from(new Set(texts)).slice(0, 400), structure };
}

async function domHash(page) {
  const sig = await page.evaluate(() => {
    const modals  = document.querySelectorAll('[role="dialog"], .ant-modal:not([aria-hidden="true"])').length;
    const total   = document.querySelectorAll("*").length;
    const firstH  = (document.querySelector("h1,h2,h3,.ant-page-header-heading-title") || {}).innerText || "";
    const drawers = document.querySelectorAll('.ant-drawer-open').length;
    return `${document.location.href}|${modals}|${total}|${firstH}|${drawers}`;
  });
  return createHash("sha256").update(sig).digest("hex");
}

async function dismissOverlay(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
  for (const s of [
    '[aria-label="Close"]', '.ant-modal-close', '.ant-drawer-close',
    '[class*="close" i][role="button"]', 'button:has-text("Cancel")',
  ]) {
    const loc = page.locator(s).first();
    if (await loc.count() && await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      break;
    }
  }
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + "…" : s; }
