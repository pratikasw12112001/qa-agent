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
  liveUrl, sessionPath, maxStates = 60, maxDepth = 4, waitAfterClickMs = 1200,
  prdHints = { screens: [], actions: [] },
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

  const prdActions  = (prdHints.actions || []).map((a) => a.toLowerCase());
  const prdScreens  = (prdHints.screens || []).map((s) => s.toLowerCase());
  if (prdActions.length) console.log(`   PRD hints: ${prdActions.length} action(s), ${prdScreens.length} screen(s) — will prioritize matching elements`);

  const states           = [];
  const seenHashes       = new Set();
  const clickedKeys      = new Set();  // global dedup of (stateKey, elementText) pairs
  const agentCreatedUrls = new Set();  // URLs the agent navigated to after a form submit
                                       // Edit flows are only attempted on these URLs

  // ── Capture root state ───────────────────────────────────────────────────
  const root = await captureState(page, {
    id: "s0", parent: null, triggerDesc: "initial load",
    url: page.url(), depth: 0, baseUrl: page.url(), entryClicks: [],
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

    // Navigate to the nearest URL ancestor, then replay clicks to reach this state
    const baseUrl     = parent.baseUrl || parent.url;
    const entryClicks = parent.entryClicks || [];

    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);

      // Session guard
      if (await detectLoginPage(page)) {
        console.log(`   → mid-run session expired, re-logging in`);
        await performLoginOnPage(page, email, password);
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }

      // Replay entry clicks to restore overlay/modal context
      for (const ec of entryClicks) {
        await page.addStyleTag({
          content: `tr td button, tr td [role="button"], tr td .ant-btn, tr td .ant-space, tr td .ant-space-item
            { opacity:1!important; visibility:visible!important; pointer-events:auto!important; }`,
        }).catch(() => {});
        await page.locator('[data-row-key], .ant-table-row').first().hover({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
        const loc = page.locator(ec.selector).first();
        if (await loc.count()) {
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          await loc.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(waitAfterClickMs);
        }
      }
    } catch (e) {
      console.warn(`   ⚠ failed to re-open state ${parent.id}: ${e.message.slice(0, 60)}`);
      continue;
    }

    // ── Reveal hover-only row action buttons ─────────────────────────────────
    await page.addStyleTag({
      content: `
        .ant-table-row td .ant-btn, .ant-table-row td .ant-space .ant-btn,
        .ant-table-row td .ant-dropdown-trigger, [data-row-key] td .ant-btn,
        .ant-table-cell .ant-btn-icon-only, .ant-table-row td [role="button"],
        tr td .ant-space, tr td .ant-space-item
        { opacity:1!important; visibility:visible!important; pointer-events:auto!important; }
      `,
    }).catch(() => {});
    await page.locator('[data-row-key], .ant-table-row').first().hover({ force: true }).catch(() => {});
    await page.waitForTimeout(300);

    const clickables = await collectClickables(page);

    // Sort: PRD-action-matching elements first so they're explored before the budget runs out
    if (prdActions.length) {
      clickables.sort((a, b) => prdClickScore(b.text, prdActions) - prdClickScore(a.text, prdActions));
      const boosted = clickables.filter((c) => prdClickScore(c.text, prdActions) > 0);
      if (boosted.length) console.log(`   → PRD-boosted: ${boosted.slice(0,3).map((c) => `"${c.text}"`).join(", ")}${boosted.length > 3 ? ` +${boosted.length - 3} more` : ""}`);
    }
    console.log(`   → state ${parent.id}: ${clickables.length} clickable candidates`);

    // Dedup key includes the entry-click path so overlay items are treated separately
    const stateKey = `${baseUrl}::${entryClicks.map((e) => e.text).join(">>")}`;

    for (const el of clickables) {
      if (states.length >= maxStates) break;

      const globalKey = `${stateKey}::${el.text}`;
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

        if (BLOCKED_URL_RE.test(afterUrl)) {
          await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
          for (const ec of entryClicks) {
            await page.locator(ec.selector).first().click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(waitAfterClickMs);
          }
          continue;
        }

        const urlChanged = afterUrl !== beforeUrl;
        const domChanged = afterHash !== beforeHash;
        if (!urlChanged && !domChanged) continue;

        if (seenHashes.has(afterHash)) {
          if (urlChanged) {
            await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
            await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
            for (const ec of entryClicks) {
              await page.locator(ec.selector).first().click({ timeout: 3000 }).catch(() => {});
              await page.waitForTimeout(waitAfterClickMs);
            }
          } else {
            await dismissOverlay(page);
            for (const ec of entryClicks) {
              await page.locator(ec.selector).first().click({ timeout: 3000 }).catch(() => {});
              await page.waitForTimeout(waitAfterClickMs);
            }
          }
          continue;
        }

        // For overlay states (URL unchanged), record the click sequence so we can replay
        const newEntryClicks = urlChanged ? [] : [...entryClicks, el];
        const newBaseUrl     = urlChanged ? afterUrl : baseUrl;

        const newState = await captureState(page, {
          id: `s${stateCounter++}`, parent: parent.id,
          triggerDesc: `click "${truncate(el.text, 40)}"`,
          url: afterUrl, depth: depth + 1,
          baseUrl: newBaseUrl, entryClicks: newEntryClicks,
        });
        states.push(newState);
        seenHashes.add(newState.hash);

        // PRD screen match → push to FRONT of BFS queue so it gets explored next
        // before unrelated states consume the maxStates budget
        const prdPriority = prdScreens.length && matchesPrdScreen(newState, prdScreens);
        if (prdPriority) {
          queue.unshift({ stateId: newState.id, depth: depth + 1 });
          console.log(`     + ${newState.id} via click "${truncate(el.text, 40)}" ← PRD screen match ("${prdPriority}") — front-queued`);
        } else {
          queue.push({ stateId: newState.id, depth: depth + 1 });
          console.log(`     + ${newState.id} via click "${truncate(el.text, 40)}" (${urlChanged ? "nav" : "overlay → will explore inside"})`);
        }

        // ── Form interaction: fill + submit, then attempt edit on created entity ──
        if (states.length < maxStates && depth + 1 < maxDepth) {
          try {
            const formResult = await tryFormFill(page);
            if (formResult?.filled?.length > 0) {
              console.log(`     ↳ form filled: ${formResult.filled.map(f => `${f.field}="${f.value}"`).join(", ")}`);
              if (formResult.submitted) {
                await page.waitForTimeout(800);
                const formUrl  = page.url();
                const formHash = await domHash(page);

                // Track URL produced by this form submit — this is the agent-created entity.
                // We only attempt edit flows on URLs the agent itself navigated to after creating,
                // never on pre-existing rows (to avoid corrupting other users' data).
                if (formUrl !== afterUrl) agentCreatedUrls.add(formUrl);

                if (!seenHashes.has(formHash)) {
                  const formState = await captureState(page, {
                    id: `s${stateCounter++}`, parent: newState.id,
                    triggerDesc: `form submit "${truncate(el.text, 30)}" (${formResult.submitLabel})`,
                    url: formUrl, depth: depth + 2,
                    baseUrl: formUrl !== afterUrl ? formUrl : newBaseUrl,
                    entryClicks: formUrl !== afterUrl ? [] : [...newEntryClicks],
                    formInteraction: formResult,
                  });
                  states.push(formState);
                  seenHashes.add(formState.hash);
                  queue.push({ stateId: formState.id, depth: depth + 2 });
                  console.log(`     + ${formState.id} form submitted → ${formUrl}`);

                  // ── Edit flow: try to find and click an Edit button on the
                  // page we just landed on (the agent-created entity page).
                  // We ONLY do this when we navigated to a new URL after submit,
                  // ensuring we never touch pre-existing data owned by other users.
                  if (states.length < maxStates && formUrl !== afterUrl && depth + 3 < maxDepth) {
                    try {
                      const editLoc = await findEditButton(page);
                      if (editLoc) {
                        await editLoc.scrollIntoViewIfNeeded().catch(() => {});
                        await editLoc.click({ timeout: 4000 });
                        await page.waitForTimeout(waitAfterClickMs);
                        const editHash = await domHash(page);
                        if (!seenHashes.has(editHash)) {
                          const editState = await captureState(page, {
                            id: `s${stateCounter++}`, parent: formState.id,
                            triggerDesc: `edit agent-created entity (${formResult.submitLabel})`,
                            url: page.url(), depth: depth + 3,
                            baseUrl: page.url(), entryClicks: [],
                          });
                          states.push(editState);
                          seenHashes.add(editState.hash);
                          queue.push({ stateId: editState.id, depth: depth + 3 });
                          console.log(`     + ${editState.id} edit flow on agent-created entity → ${editState.url}`);
                        }
                      }
                    } catch { /* edit flow is best-effort */ }
                  }
                }
              }
            }
          } catch { /* form fill is best-effort */ }
        }

        if (urlChanged) {
          await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
          for (const ec of entryClicks) {
            await page.locator(ec.selector).first().click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(waitAfterClickMs);
          }
        } else {
          // Dismiss this overlay and replay parent entry to continue exploring siblings
          await dismissOverlay(page);
          for (const ec of entryClicks) {
            await page.addStyleTag({
              content: `tr td button, tr td [role="button"], tr td .ant-btn
                { opacity:1!important; visibility:visible!important; pointer-events:auto!important; }`,
            }).catch(() => {});
            await page.locator(ec.selector).first().click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(waitAfterClickMs);
          }
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

// ─── PRD hint helpers ────────────────────────────────────────────────────────

/**
 * Score how well a clickable element's text matches any PRD action.
 * Returns 0–1; higher = stronger match.
 */
function prdClickScore(text, prdActions) {
  if (!text || !prdActions.length) return 0;
  const norm = text.toLowerCase();
  let best = 0;
  for (const action of prdActions) {
    // Direct inclusion check (fast path)
    if (norm.includes(action) || action.includes(norm)) { best = 1; break; }
    // Token overlap
    const score = _tokenOverlap(norm, action);
    if (score > best) best = score;
  }
  return best;
}

/**
 * Returns the first PRD screen name (string) that matches this state,
 * or null if none match.
 * Matches against: URL path tokens and captured text headings.
 */
function matchesPrdScreen(state, prdScreens) {
  const urlNorm  = (state.url || "").toLowerCase().replace(/[^a-z0-9]/g, " ");
  const textBlob = (state.textContent || []).slice(0, 20).join(" ").toLowerCase();
  for (const screen of prdScreens) {
    if (_tokenOverlap(urlNorm, screen)  >= 0.5) return screen;
    if (_tokenOverlap(textBlob, screen) >= 0.5) return screen;
    // Fallback: every word in the screen name appears somewhere in the text
    const words = screen.split(/\s+/).filter((w) => w.length > 2);
    if (words.length && words.every((w) => textBlob.includes(w))) return screen;
  }
  return null;
}

function _tokenOverlap(a, b) {
  const ta = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const tb = new Set(b.split(/\s+/).filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  for (const w of ta) if (tb.has(w)) hits++;
  return hits / Math.min(ta.size, tb.size);
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
      // Overlay / dropdown / modal contents — explored when overlay is open
      '.ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled)',
      '.ant-menu-item:not(.ant-menu-item-disabled)',
      '.ant-select-item-option:not(.ant-select-item-option-disabled)',
      '[role="menuitem"]:not([disabled])',
      '[role="option"]:not([disabled])',
      '.ant-modal-body button:not([disabled])',
      '.ant-modal-footer button:not([disabled])',
      '.ant-drawer-body button:not([disabled])',
      '.ant-popover-inner button:not([disabled])',
      '.ant-popover-inner [role="button"]:not([disabled])',
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
  // JPEG at 75% quality keeps screenshots small (target ~100KB vs ~1MB PNG)
  const screenshot     = await page.screenshot({ fullPage: false, type: "jpeg", quality: 75 });
  const dom            = await page.evaluate(extractDom);
  const cssProps       = await page.evaluate(extractCssProperties);
  const croppedRegions = await captureKeyRegions(page);
  const hash = createHash("sha256")
    .update(meta.url)
    .update(dom.texts.join("|").slice(0, 4000))
    .update(JSON.stringify(dom.structure))
    .update((meta.entryClicks || []).map(e => e.text).join(">"))
    .digest("hex");
  return {
    id: meta.id, parent: meta.parent, triggerDesc: meta.triggerDesc,
    url: meta.url, depth: meta.depth,
    baseUrl: meta.baseUrl || meta.url,
    entryClicks: meta.entryClicks || [],
    formInteraction: meta.formInteraction || null,
    screenshot: screenshot.toString("base64"),
    textContent: dom.texts,
    structure: dom.structure,
    cssProperties: cssProps,
    croppedRegions,
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

/**
 * Captures cropped screenshots of the 2 most important UI regions:
 * (1) header/title area, (2) primary button or first form row.
 * Used by compare.mjs for focused vision analysis at 5-10x zoom.
 */
async function captureKeyRegions(page) {
  const clips = await page.evaluate(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const regions = [];

    // Region 1: heading / page title (top area, first visible h1/h2/header)
    const heading = document.querySelector(
      "h1, h2, .ant-page-header-heading-title, [class*='page-title' i], [class*='heading' i]"
    );
    if (heading) {
      const r = heading.getBoundingClientRect();
      if (r.width > 50 && r.height > 8 && r.top >= 0 && r.top < H) {
        regions.push({
          label: "header",
          x: 0,
          y: Math.max(0, r.top - 24),
          width: W,
          height: Math.min(220, r.height + 80),
        });
      }
    }

    // Region 2: primary CTA button or first visible form group
    const cta =
      document.querySelector(".ant-btn-primary:not([disabled])") ||
      document.querySelector("button[type='submit']:not([disabled])") ||
      document.querySelector(".ant-form-item");
    if (cta) {
      const r = cta.getBoundingClientRect();
      if (r.width > 40 && r.height > 16 && r.top >= 0 && r.top < H) {
        const pad = 40;
        regions.push({
          label: "primary-action",
          x: Math.max(0, r.left - pad),
          y: Math.max(0, r.top - pad),
          width:  Math.min(W, r.width  + pad * 2),
          height: Math.min(H, r.height + pad * 2),
        });
      }
    }

    return regions.slice(0, 2);
  });

  const results = [];
  for (const clip of clips) {
    try {
      const w = Math.max(clip.width,  10);
      const h = Math.max(clip.height, 10);
      const buf = await page.screenshot({
        clip: { x: clip.x, y: clip.y, width: w, height: h },
        type: "jpeg", quality: 88,
      });
      results.push({ label: clip.label, screenshot: buf.toString("base64") });
    } catch { /* clip may fail if element scrolled out — skip */ }
  }
  return results;
}

/**
 * Extracts computed CSS values for major UI elements:
 * primary buttons, headings (h1/h2), inputs, and body text.
 * Only captures major params: font-size, font-weight, color, background-color,
 * padding, border-radius, font-family.
 */
function extractCssProperties() {
  const CSS_PROPS = [
    "fontSize", "fontWeight", "fontFamily", "color",
    "backgroundColor", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderRadius", "lineHeight",
  ];

  function getStyles(el) {
    const cs = window.getComputedStyle(el);
    const out = {};
    for (const p of CSS_PROPS) out[p] = cs[p] || "";
    return out;
  }

  function describeEl(el) {
    const txt = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40);
    return txt || el.className?.split(" ")[0] || el.tagName.toLowerCase();
  }

  const result = { buttons: [], headings: [], inputs: [], bodyText: [] };

  // Primary / CTA buttons — must be real labeled buttons, not table row actions or icons.
  // Order matters: more specific selectors first so we sample the most representative button.
  const btnSels = [
    ".ant-btn-primary:not(.ant-btn-icon-only):not([disabled])",
    "button[type='submit']:not([disabled])",
    ".ant-btn:not(.ant-btn-link):not(.ant-btn-text):not(.ant-btn-icon-only):not([disabled])",
  ];
  const seenBtns = new Set();
  for (const sel of btnSels) {
    if (result.buttons.length >= 3) break;
    for (const el of document.querySelectorAll(sel)) {
      if (result.buttons.length >= 3) break;
      // Skip buttons inside table rows — they are row-action icons, not representative CTAs
      if (el.closest("tr, .ant-table-row, .ant-table-tbody, td, .ant-table-cell")) continue;
      const rect = el.getBoundingClientRect();
      // Require minimum 72×28px — filters out icon buttons (typically 24-32px square)
      if (rect.width < 72 || rect.height < 28) continue;
      // Must have a real text label (not just an icon)
      const label = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
      if (!label || label.length < 2) continue;
      if (seenBtns.has(label)) continue;
      seenBtns.add(label);
      result.buttons.push({ label: label.slice(0, 40), styles: getStyles(el) });
    }
  }

  // Headings (h1, h2 — limit 2) — must be visible and in viewport
  for (const el of document.querySelectorAll("h1, h2, .ant-page-header-heading-title")) {
    if (result.headings.length >= 2) break;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 8) continue;
    if (rect.top < 0 || rect.top > window.innerHeight) continue;
    const text = (el.innerText || el.textContent || "").trim();
    if (!text) continue;
    result.headings.push({ label: text.slice(0, 40), styles: getStyles(el) });
  }

  // Inputs (limit 2)
  for (const el of document.querySelectorAll("input[type='text'], input[type='email'], textarea, .ant-input")) {
    if (result.inputs.length >= 2) break;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 16) continue;
    result.inputs.push({ label: el.placeholder || el.name || "input", styles: getStyles(el) });
  }

  // Body/paragraph text (first visible p or span with meaningful text — limit 1)
  for (const el of document.querySelectorAll("p, .ant-table-cell, td")) {
    if (result.bodyText.length >= 1) break;
    const t = (el.innerText || "").trim();
    if (t.length < 10) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40) continue;
    result.bodyText.push({ label: t.slice(0, 30), styles: getStyles(el) });
  }

  return result;
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

/**
 * Finds an Edit/Modify button on the current page.
 * Only matches buttons whose text or aria-label clearly signals an edit action.
 * Returns a Playwright Locator, or null if nothing suitable is found.
 */
async function findEditButton(page) {
  const EDIT_TEXTS = ["Edit", "Modify", "Update", "Configure", "Settings", "Edit details"];
  for (const text of EDIT_TEXTS) {
    for (const sel of [
      `.ant-btn:has-text("${text}")`,
      `button:has-text("${text}")`,
      `[role="button"]:has-text("${text}")`,
      `[aria-label="${text}"]`,
    ]) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() && await loc.isVisible().catch(() => false) &&
            !await loc.isDisabled().catch(() => true)) {
          return loc;
        }
      } catch { /* try next */ }
    }
  }
  return null;
}

// ─── Form interaction ─────────────────────────────────────────────────────────
/**
 * Detects visible form inputs, fills them with sensible test data, and attempts
 * to submit the form. Returns a result object if any inputs were filled.
 */
export async function tryFormFill(page) {
  // Collect all visible, unfilled inputs
  const inputs = await page.evaluate(() => {
    const SKIP_TYPES = new Set(["hidden","submit","button","reset","checkbox","radio","file","image"]);
    const results = [];
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (SKIP_TYPES.has((el.type || "").toLowerCase())) continue;
      if (el.disabled || el.readOnly) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const label = (
        document.querySelector(`label[for="${el.id}"]`)?.innerText ||
        el.closest("label")?.innerText || ""
      ).trim().toLowerCase();
      results.push({
        tag:         el.tagName.toLowerCase(),
        type:        el.type || "text",
        id:          el.id,
        name:        el.name,
        placeholder: el.placeholder || "",
        label,
        value:       el.value || "",
        isSelect:    el.tagName.toLowerCase() === "select",
      });
    }
    return results;
  });

  const emptyInputs = inputs.filter(i => !i.value);
  if (emptyInputs.length === 0) return null;

  const filled = [];

  for (const inp of emptyInputs) {
    const value = generateFormValue(inp);
    if (!value) continue;

    // Build a reliable selector
    let sel;
    if (inp.id)   sel = `#${inp.id}`;
    else if (inp.name) sel = `[name="${inp.name}"]`;
    else          sel = inp.tag === "textarea" ? "textarea" : `input[type="${inp.type}"]`;

    try {
      if (inp.isSelect) {
        // Pick first real option
        await page.evaluate((s) => {
          const el = document.querySelector(s);
          if (el && el.options.length > 1) el.selectedIndex = 1;
        }, sel);
      } else if (inp.tag === "textarea" || inp.type === "text" || inp.type === "email" ||
                 inp.type === "number"  || inp.type === "tel"   || inp.type === "url"  ||
                 inp.type === "password"|| inp.type === "search" || inp.type === "") {
        await page.fill(sel, value, { timeout: 3000 });
      }
      filled.push({ field: inp.label || inp.placeholder || inp.name || inp.id || inp.type, value });
    } catch {
      // field not interactable — skip
    }
  }

  if (filled.length === 0) return null;

  // Try to click a Submit / Save / Create / Add / OK button
  const SUBMIT_TEXTS = ["Submit","Save","Create","Add","OK","Confirm","Apply","Done","Next","Continue"];
  let submitted = false;
  let submitLabel = "";

  for (const text of SUBMIT_TEXTS) {
    for (const sel of [
      `.ant-modal-footer button:has-text("${text}")`,
      `.ant-drawer-footer button:has-text("${text}")`,
      `button[type="submit"]`,
      `button:has-text("${text}")`,
      `.ant-btn-primary:has-text("${text}")`,
    ]) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() && await loc.isVisible().catch(() => false) &&
            !await loc.isDisabled().catch(() => true)) {
          await loc.click({ timeout: 3000 });
          await page.waitForTimeout(1800);
          submitted = true;
          submitLabel = text;
          break;
        }
      } catch { /* try next */ }
    }
    if (submitted) break;
  }

  return { filled, submitted, submitLabel };
}

/** Generates a sensible test value based on field hints */
function generateFormValue(inp) {
  const hint = `${inp.label} ${inp.placeholder} ${inp.name} ${inp.id}`.toLowerCase();
  if (inp.isSelect) return null; // handled separately

  if (inp.type === "email"    || hint.includes("email"))    return "qa-agent@test.com";
  if (inp.type === "tel"      || hint.includes("phone") || hint.includes("mobile")) return "+1234567890";
  if (inp.type === "url"      || hint.includes("url")  || hint.includes("link"))    return "https://example.com";
  if (inp.type === "number"   || hint.includes("count") || hint.includes("qty"))    return "1";
  if (inp.type === "password" || hint.includes("password"))                         return "TestPass123!";
  if (inp.type === "date"     || hint.includes("date"))     return new Date().toISOString().slice(0,10);
  if (hint.includes("name") || hint.includes("title"))      return "QA Test Entry";
  if (hint.includes("desc")  || hint.includes("note") || hint.includes("comment")) return "Created by QA agent";
  if (hint.includes("search")) return "test";
  if (inp.tag === "textarea") return "QA agent test content";
  return "QA Test";
}
