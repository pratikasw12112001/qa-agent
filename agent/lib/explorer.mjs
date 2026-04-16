/**
 * Smart state-graph exploration.
 *
 * Starts at the user-provided source URL (after login).
 * Clicks interactive elements in the MAIN content area (sidebar/nav excluded)
 * and captures every resulting state:
 *   - new URL  → sub-page
 *   - modal    → overlay state
 *   - popup    → menu / tooltip
 *   - expanded → accordion / dropdown
 *
 * Returns a state graph: [{ id, url, screenshot, dom, textContent, structure, parent, triggerDesc }]
 */

import { chromium } from "playwright";
import { createHash } from "crypto";

const SIDEBAR_SELECTORS = [
  ".ant-menu", ".ant-layout-sider", ".ant-menu-root",
  '[class*="sidebar" i]', '[class*="side-bar" i]',
  '[class*="side-nav" i]',  '[class*="sidenav" i]',
  '[class*="left-menu" i]', '[class*="leftmenu" i]',
  '[class*="left-nav" i]',
  'nav[class*="side" i]', 'aside',
  'nav[role="navigation"]',
].join(", ");

// Elements we must never click (destructive or off-topic)
const BLOCKED_TEXT = [
  "log out", "logout", "sign out", "signout",
  "delete account", "delete", "remove account",
];

export async function exploreStates({
  liveUrl, sessionPath, maxStates = 30, maxDepth = 3, waitAfterClickMs = 1200,
}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: sessionPath,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const states = [];
  const seenHashes = new Set();

  console.log(`   → opening source URL: ${liveUrl}`);
  await page.goto(liveUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

  // Capture root state
  const root = await captureState(page, {
    id: "s0", parent: null, triggerDesc: "initial load",
    url: page.url(), depth: 0,
  });
  states.push(root);
  seenHashes.add(root.hash);

  const queue = [{ stateId: root.id, depth: 0 }];
  let stateCounter = 1;

  while (queue.length && states.length < maxStates) {
    const { stateId, depth } = queue.shift();
    if (depth >= maxDepth) continue;

    // Re-navigate to this state's URL so selectors are valid
    const parent = states.find((s) => s.id === stateId);
    if (!parent) continue;

    try {
      await page.goto(parent.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    } catch (e) {
      console.warn(`   ⚠ failed to re-open ${parent.url}: ${e.message.slice(0, 60)}`);
      continue;
    }

    // Collect clickable elements in main content (sidebar excluded)
    const clickables = await collectClickables(page);
    console.log(`   → state ${parent.id}: ${clickables.length} clickable candidates`);

    for (const el of clickables) {
      if (states.length >= maxStates) break;

      const beforeUrl  = page.url();
      const beforeHash = await domHash(page);

      try {
        // Hover first so element is in view, then click
        const locator = page.locator(el.selector).first();
        if (!(await locator.count())) continue;
        if (!(await locator.isVisible().catch(() => false))) continue;

        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await locator.click({ timeout: 4000, trial: false }).catch(() => {});
        await page.waitForTimeout(waitAfterClickMs);

        const afterUrl = page.url();
        const afterHash = await domHash(page);

        // Decide if we reached a new state
        const urlChanged = afterUrl !== beforeUrl;
        const domChanged = afterHash !== beforeHash;

        if (!urlChanged && !domChanged) continue;       // nothing happened
        if (seenHashes.has(afterHash)) {                // already seen
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

        // Return to parent state
        if (urlChanged) {
          await page.goto(parent.url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        } else {
          await dismissOverlay(page);
        }
      } catch {
        // swallow — try next element
      }
    }
  }

  await browser.close();
  console.log(`   → ${states.length} unique state(s) captured`);
  return states;
}

// ─── captureState ───────────────────────────────────────────────────────────

async function captureState(page, meta) {
  const screenshot = await page.screenshot({ fullPage: false, type: "png" });
  const dom        = await page.evaluate(extractDom);
  const textContent = dom.texts;
  const structure  = dom.structure;
  const hash = createHash("sha256")
    .update(meta.url)
    .update(textContent.join("|").slice(0, 4000))
    .update(JSON.stringify(structure))
    .digest("hex");

  return {
    id: meta.id, parent: meta.parent, triggerDesc: meta.triggerDesc,
    url: meta.url, depth: meta.depth,
    screenshot: screenshot.toString("base64"),
    textContent, structure, hash,
  };
}

async function collectClickables(page) {
  return await page.evaluate(({ sidebarSel, blocked }) => {
    function isInSidebar(el) {
      return !!el.closest(sidebarSel);
    }
    function unique(selector, el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const tag = el.tagName.toLowerCase();
      const cls = (el.className && typeof el.className === "string")
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).map(CSS.escape).join(".")
        : "";
      return `${tag}${cls}:nth-of-type(${selector.index + 1})`;
    }

    const candidates = Array.from(document.querySelectorAll(
      'button, a[href], [role="button"], [role="tab"], [role="link"], ' +
      '[role="menuitem"], [onclick], input[type="button"], input[type="submit"], ' +
      'tr[class*="row" i], td[class*="clickable" i], [class*="card" i]'
    ));

    const out = [];
    const seenText = new Set();

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (isInSidebar(el)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) continue;
      if (rect.bottom < 0 || rect.top > 10000) continue;

      const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
      const textNorm = text.toLowerCase();
      if (textNorm && blocked.some((b) => textNorm.includes(b))) continue;

      // Build a stable-ish selector using text if possible
      let selector;
      if (text && text.length > 1 && text.length < 40) {
        const tag = el.tagName.toLowerCase();
        selector = `${tag}:has-text("${text.replace(/"/g, '\\"').slice(0, 40)}")`;
      } else {
        selector = unique({ index: i }, el);
      }

      // Dedupe by text
      const key = textNorm || selector;
      if (seenText.has(key)) continue;
      seenText.add(key);

      out.push({ selector, text: text || "(no text)", tag: el.tagName.toLowerCase() });
      if (out.length >= 20) break;    // cap per state
    }
    return out;
  }, { sidebarSel: SIDEBAR_SELECTORS, blocked: BLOCKED_TEXT });
}

function extractDom() {
  const texts = [];
  document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,a,button,label,td,th,li")
    .forEach((el) => {
      const t = (el.innerText || "").trim();
      if (t && t.length > 1 && t.length < 200) texts.push(t);
    });

  const structure = {
    buttons: document.querySelectorAll('button, [role="button"]').length,
    inputs:  document.querySelectorAll("input, textarea, select").length,
    images:  document.querySelectorAll("img").length,
    links:   document.querySelectorAll("a[href]").length,
    tables:  document.querySelectorAll("table").length,
    headings: document.querySelectorAll("h1,h2,h3,h4").length,
    modals:  document.querySelectorAll('[role="dialog"], .ant-modal, [class*="modal" i]').length,
    total:   document.querySelectorAll("*").length,
  };

  return { texts: Array.from(new Set(texts)).slice(0, 400), structure };
}

async function domHash(page) {
  const sig = await page.evaluate(() => {
    const counts = {
      modals: document.querySelectorAll('[role="dialog"], .ant-modal:not([aria-hidden="true"]), [class*="modal" i]').length,
      total:  document.querySelectorAll("*").length,
    };
    const firstH = (document.querySelector("h1,h2,h3") || {}).innerText || "";
    return `${document.location.href}|${counts.modals}|${counts.total}|${firstH}`;
  });
  return createHash("sha256").update(sig).digest("hex");
}

async function dismissOverlay(page) {
  // Try Escape, then click close button, then click backdrop
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  const closeSelectors = [
    '[aria-label="Close"]', '.ant-modal-close', '[class*="close" i][role="button"]',
  ];
  for (const s of closeSelectors) {
    const loc = page.locator(s).first();
    if (await loc.count() && await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 2000 }).catch(() => {});
      break;
    }
  }
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + "…" : s; }
