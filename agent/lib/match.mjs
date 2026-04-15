/**
 * Matching module
 * 1. matchFramesToRoutes  — pair Figma frames to live app URLs
 * 2. matchNodesToElements — pair Figma child nodes to DOM elements
 */

import { launchBrowser, newContext } from "./browser.mjs";

const MAX_SCREENS = 8; // test at most 8 screens per run

// Selectors that identify the left-sidebar / module-navigation.
// Clicks inside these are ignored when discovering sub-pages.
const SIDEBAR_SELECTORS =
  '.ant-menu, .ant-layout-sider, .ant-menu-root, ' +
  '[class*="sidebar"], [class*="side-bar"], [class*="left-menu"], ' +
  '[class*="side-nav"], [class*="sidenav"], nav, [role="navigation"]';

// ─── Frame → Route Matching ───────────────────────────────────────────────────

/**
 * Strategy:
 *   • Specific-path URL (e.g. /logbook):
 *       Navigate there, collect content-area links and click content buttons
 *       to discover sub-pages.  Sidebar links are intentionally ignored.
 *       Only URLs that stay under the same path prefix are kept.
 *   • Base-domain URL:
 *       Crawl broadly using existing sidebar-click approach.
 */
export async function matchFramesToRoutes(frames, baseUrl, sessionPath) {
  const urlObj = new URL(baseUrl);
  const isSpecificPath = urlObj.pathname !== "/" && urlObj.pathname !== "";

  let routes;
  if (isSpecificPath) {
    console.log(`   Specific URL — discovering sub-pages under: ${baseUrl}`);
    routes = await discoverSubRoutes(baseUrl, sessionPath);
    console.log(`   Found ${routes.length} sub-page(s)`);
  } else {
    console.log(`   Base URL — crawling app routes`);
    routes = await discoverRoutes(baseUrl, sessionPath);
    console.log(`   Discovered ${routes.length} routes`);
  }

  // For each route, find the best matching Figma frame
  const matched = [];
  const usedFrameIds = new Set();
  const threshold = isSpecificPath ? 0.1 : 0.35; // lower bar for explicit URLs

  for (const route of routes) {
    let best = null;
    let bestScore = 0;

    for (const frame of frames) {
      if (usedFrameIds.has(frame.id)) continue;
      const score = routeFrameScore(route, frame);
      if (score > bestScore) { bestScore = score; best = frame; }
    }

    if (best && bestScore >= threshold) {
      usedFrameIds.add(best.id);
      matched.push({ ...best, url: route.url, matchScore: bestScore });
      console.log(`   [${bestScore.toFixed(2)}] "${best.name}" → ${route.url}`);
    }

    if (matched.length >= MAX_SCREENS) break;
  }

  // Absolute fallback: use the provided URL with the best-named frame
  if (matched.length === 0 && frames.length > 0) {
    const slug = normalize(urlSlug(baseUrl));
    let top = frames[0]; let topScore = 0;
    for (const f of frames) {
      const s = similarity(normalize(f.name), slug);
      if (s > topScore) { topScore = s; top = f; }
    }
    console.log(`   No matches — using best frame "${top.name}" at ${baseUrl}`);
    matched.push({ ...top, url: baseUrl, matchScore: topScore });
  }

  return matched;
}

// ─── Sub-page discovery (specific URL mode) ───────────────────────────────────

/**
 * Navigate to the user-supplied URL, then:
 *   1. Collect <a href> links that live in the content area (not sidebar)
 *      AND whose path starts with the same prefix.
 *   2. Click buttons / action elements in the content area.
 *      If the URL changes to a sub-path, record it then go back.
 * Sidebar / left-nav links are always skipped.
 */
async function discoverSubRoutes(baseUrl, sessionPath) {
  const browser = await launchBrowser(true);
  const origin  = new URL(baseUrl).origin;
  const basePath = new URL(baseUrl).pathname.replace(/\/$/, ""); // e.g. "/logbook"
  const routes  = [];
  const seen    = new Set();

  function isSubPath(url) {
    try {
      const p = new URL(url).pathname;
      return p === basePath || p.startsWith(basePath + "/");
    } catch { return false; }
  }

  function addRoute(url, text, title = "", heading = "") {
    const clean = url.split("?")[0].split("#")[0];
    if (!clean.startsWith(origin)) return;
    if (!isSubPath(clean)) return;          // stay within the section
    if (seen.has(clean)) return;
    seen.add(clean);
    routes.push({ url: clean, text, title, heading });
  }

  try {
    const context = await newContext(browser, sessionPath);
    const page    = await context.newPage();

    // ── Step 1: land on the provided URL ─────────────────────────────────────
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const rootTitle   = await page.title();
    const rootHeading = await page.evaluate(getHeading);
    addRoute(baseUrl, rootTitle, rootTitle, rootHeading);

    // ── Step 2: collect <a href> sub-path links NOT inside sidebar ────────────
    const hrefLinks = await page.evaluate(
      ({ origin, basePath, sidebarSel }) => {
        const results = [];
        document.querySelectorAll("a[href]").forEach((a) => {
          if (a.closest(sidebarSel)) return;           // skip sidebar links
          const href = a.href || "";
          if (!href) return;
          try {
            const full = new URL(href, location.origin).href;
            const p    = new URL(full).pathname;
            if (!full.startsWith(origin)) return;
            if (p !== basePath && !p.startsWith(basePath + "/")) return;
            results.push({ href: full.split("?")[0].split("#")[0], text: a.textContent.trim() });
          } catch { /* skip */ }
        });
        return results;
      },
      { origin, basePath, sidebarSel: SIDEBAR_SELECTORS }
    );

    for (const l of hrefLinks) addRoute(l.href, l.text);
    console.log(`   ${hrefLinks.length} content-area <a> links found`);

    // ── Step 3: click content buttons / actions and track URL changes ─────────
    // Selectors for interactive elements that might open sub-pages.
    // We purposely omit sidebar selectors.
    const clickTargets = [
      "button:not([disabled])",
      ".ant-btn:not([disabled])",
      "[class*='action-btn']:not([disabled])",
      "tbody tr",                       // table rows often navigate
      "[class*='clickable']",
      "[class*='row-click']",
      "[class*='list-item']",
    ];

    for (const sel of clickTargets) {
      // Re-query after each navigation back to base
      let items;
      try {
        items = await page.locator(sel).all();
      } catch { continue; }

      for (const item of items.slice(0, 12)) {
        try {
          // Skip if element is inside sidebar
          const inSidebar = await item.evaluate(
            (el, ss) => !!el.closest(ss),
            SIDEBAR_SELECTORS
          );
          if (inSidebar) continue;

          const urlBefore = page.url().split("?")[0].split("#")[0];
          await item.click({ timeout: 3000 });
          await page.waitForTimeout(1000);

          const urlAfter = page.url().split("?")[0].split("#")[0];
          if (urlAfter !== urlBefore && isSubPath(urlAfter)) {
            const t = await page.title();
            const h = await page.evaluate(getHeading);
            const label = await item.textContent().catch(() => "");
            addRoute(urlAfter, label.trim(), t, h);
            console.log(`   Button click → ${urlAfter}`);
            // Return to base page to keep discovering
            await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
            await page.waitForTimeout(1000);
          }
        } catch { /* skip unclickable items */ }
      }

      if (routes.length >= MAX_SCREENS + 2) break;
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return routes;
}

// ─── Full-app route discovery (base-domain mode) ──────────────────────────────

/** Crawl the live app and collect all unique internal routes (SPA-aware) */
async function discoverRoutes(baseUrl, sessionPath) {
  const browser = await launchBrowser(true);
  const routes  = [];
  const origin  = new URL(baseUrl).origin;
  const seen    = new Set();

  function addRoute(url, text, title = "", heading = "") {
    const clean = url.split("?")[0].split("#")[0];
    if (!clean.startsWith(origin)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    routes.push({ url: clean, text, title, heading });
  }

  try {
    const context = await newContext(browser, sessionPath);
    const page    = await context.newPage();

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url().split("?")[0].split("#")[0];
        if (url.startsWith(origin) && !seen.has(url)) seen.add(url);
      }
    });

    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    addRoute(baseUrl, await page.title());

    const hrefLinks = await page.evaluate((origin) => {
      const links = [];
      document.querySelectorAll("a[href]").forEach((a) => {
        const href = a.href || "";
        if (href.startsWith(origin) || href.startsWith("/")) {
          links.push({
            href: href.startsWith("/") ? (origin + href) : href,
            text: a.textContent ? a.textContent.trim() : "",
          });
        }
      });
      return links;
    }, origin);

    for (const l of hrefLinks) addRoute(l.href, l.text);

    const navSelectors = [
      ".ant-menu-item", ".ant-menu-submenu-title",
      "[role='menuitem']", "nav li",
      ".sidebar-item", "[class*='menu-item']", "[class*='nav-item']",
    ];

    for (const sel of navSelectors) {
      const items = await page.locator(sel).all();
      for (const item of items.slice(0, 15)) {
        try {
          const text = (await item.textContent() || "").trim();
          if (!text || text.length < 2) continue;
          await item.click({ timeout: 3000 });
          await page.waitForTimeout(800);
          addRoute(page.url(), text, "", "");
        } catch { /* skip */ }
      }
      if (routes.length > 15) break;
    }

    for (const route of routes.slice(1)) {
      try {
        await page.goto(route.url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(600);
        route.title   = await page.title();
        route.heading = await page.evaluate(getHeading);
      } catch { /* skip */ }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return routes;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** page.evaluate callback — returns the prominent heading text */
function getHeading() {
  const h = document.querySelector(
    "h1, h2, .ant-page-header-heading-title, [class*='page-title']"
  );
  return h ? h.textContent.trim() : "";
}

/** Score how well a live route matches a Figma frame */
function routeFrameScore(route, frame) {
  const frameName = normalize(frame.name);
  const framePage = normalize(frame.page ?? "");

  const candidates = [
    normalize(route.text ?? ""),
    normalize(route.title ?? ""),
    normalize(route.heading ?? ""),
    normalize(urlSlug(route.url)),
  ].filter(Boolean);

  let best = 0;
  for (const candidate of candidates) {
    const s  = similarity(frameName, candidate);
    if (s > best) best = s;
    if (framePage) {
      const sp = similarity(framePage, candidate);
      if (sp > best) best = sp;
    }
  }
  return best;
}

function urlSlug(url) {
  try {
    const path = new URL(url).pathname;
    return path.replace(/\//g, " ").replace(/-/g, " ").trim();
  } catch { return url; }
}

// ─── Node → Element Matching ─────────────────────────────────────────────────

export function matchNodesToElements(figmaNodes, liveElements, frameWidth, frameHeight) {
  const pairs       = [];
  const usedLiveIds = new Set();

  const matchableNodes = figmaNodes.filter(
    (n) => n.bbox.w > 10 && n.bbox.h > 10 &&
    !["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "ELLIPSE"].includes(n.type)
  );

  for (const figmaNode of matchableNodes) {
    let bestEl = null; let bestScore = 0;

    const fxRel = figmaNode.bbox.x / frameWidth;
    const fyRel = figmaNode.bbox.y / frameHeight;
    const fwRel = figmaNode.bbox.w / frameWidth;
    const fhRel = figmaNode.bbox.h / frameHeight;

    for (const el of liveElements) {
      const id = `${el.bbox.x},${el.bbox.y}`;
      if (usedLiveIds.has(id)) continue;
      const score = matchScore(figmaNode, fxRel, fyRel, fwRel, fhRel, el, frameWidth, frameHeight);
      if (score > bestScore) { bestScore = score; bestEl = el; }
    }

    if (bestScore > 0.5 && bestEl) {
      usedLiveIds.add(`${bestEl.bbox.x},${bestEl.bbox.y}`);
      pairs.push({ figmaNode, liveElement: bestEl, score: bestScore });
    } else {
      pairs.push({ figmaNode, liveElement: null, score: 0 });
    }
  }

  const unmatchedLive = liveElements.filter(
    (el) => !usedLiveIds.has(`${el.bbox.x},${el.bbox.y}`)
  );

  return { pairs, unmatchedLive };
}

function matchScore(figmaNode, fxRel, fyRel, fwRel, fhRel, liveEl, frameWidth, frameHeight) {
  const scores = [];

  if (figmaNode.text && liveEl.text) {
    const textSim = similarity(normalize(figmaNode.text), normalize(liveEl.text));
    scores.push({ w: 0.5, v: textSim });
  }

  const lxRel  = liveEl.bbox.x / frameWidth;
  const lyRel  = liveEl.bbox.y / frameHeight;
  const posSim = 1 - Math.min(1, Math.sqrt((fxRel - lxRel) ** 2 + (fyRel - lyRel) ** 2) * 3);
  scores.push({ w: 0.3, v: Math.max(0, posSim) });

  const lwRel  = liveEl.bbox.w / frameWidth;
  const lhRel  = liveEl.bbox.h / frameHeight;
  const sizeSim = 1 - Math.min(1, (Math.abs(fwRel - lwRel) + Math.abs(fhRel - lhRel)) * 2);
  scores.push({ w: 0.2, v: Math.max(0, sizeSim) });

  const totalW = scores.reduce((s, sc) => s + sc.w, 0);
  return scores.reduce((s, sc) => s + (sc.v * sc.w) / totalW, 0);
}

// ─── String utilities ─────────────────────────────────────────────────────────

function normalize(str) {
  return (str ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;

  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const aBi = bigrams(a);
  const bBi = bigrams(b);
  const intersection = [...aBi].filter((bg) => bBi.has(bg)).length;
  return (2 * intersection) / (aBi.size + bBi.size);
}
