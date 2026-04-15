/**
 * Matching module
 * 1. matchFramesToRoutes  — pair Figma frames to live app URLs
 * 2. matchNodesToElements — pair Figma child nodes to DOM elements
 */

import { launchBrowser, newContext } from "./browser.mjs";

const MAX_SCREENS = 8; // test at most 8 screens per run

// ─── Frame → Route Matching ───────────────────────────────────────────────────

/**
 * If the user gave a specific-path URL (e.g. /logbook), use it directly.
 * Otherwise crawl the app to discover routes, then match each route
 * to the best Figma frame by name similarity.
 */
export async function matchFramesToRoutes(frames, baseUrl, sessionPath) {
  let routes;

  const urlObj = new URL(baseUrl);
  const isSpecificPath = urlObj.pathname !== "/" && urlObj.pathname !== "";

  if (isSpecificPath) {
    // User gave a specific page URL — crawl starting from it, prioritise sub-routes
    console.log(`   Specific URL provided — crawling from: ${baseUrl}`);
    const allRoutes = await discoverRoutes(baseUrl, sessionPath);
    // Keep routes that are sub-paths of the provided URL first, then others
    const subPath = urlObj.pathname.replace(/\/$/, "");
    routes = [
      ...allRoutes.filter(r => {
        try { return new URL(r.url).pathname.startsWith(subPath); } catch { return false; }
      }),
      ...allRoutes.filter(r => {
        try { return !new URL(r.url).pathname.startsWith(subPath); } catch { return false; }
      }),
    ];
    console.log(`   Found ${routes.length} routes (${routes.filter(r => {
      try { return new URL(r.url).pathname.startsWith(subPath); } catch { return false; }
    }).length} under ${subPath})`);
  } else {
    // Base domain — crawl to discover all routes
    routes = await discoverRoutes(baseUrl, sessionPath);
    console.log(`   Discovered ${routes.length} real routes in the live app`);
  }

  // For each route, find the best matching Figma frame
  const matched = [];
  const usedFrameIds = new Set();

  for (const route of routes) {
    let best = null;
    let bestScore = 0;

    for (const frame of frames) {
      if (usedFrameIds.has(frame.id)) continue;
      const score = routeFrameScore(route, frame);
      if (score > bestScore) {
        bestScore = score;
        best = frame;
      }
    }

    // Lower threshold for specific URLs — user explicitly targeted this page
    const threshold = isSpecificPath ? 0.1 : 0.35;

    if (best && bestScore >= threshold) {
      usedFrameIds.add(best.id);
      matched.push({ ...best, url: route.url, matchScore: bestScore });
      console.log(`   [${bestScore.toFixed(2)}] "${best.name}" → ${route.url}`);
    }

    if (matched.length >= MAX_SCREENS) break;
  }

  // Fallback: use the provided URL with the single best-named frame
  if (matched.length === 0 && frames.length > 0) {
    // Pick the frame whose name best matches the URL slug (any score)
    const slug = normalize(urlSlug(baseUrl));
    let top = frames[0];
    let topScore = 0;
    for (const f of frames) {
      const s = similarity(normalize(f.name), slug);
      if (s > topScore) { topScore = s; top = f; }
    }
    console.log(`   No route matches — falling back to best frame "${top.name}" at ${baseUrl}`);
    matched.push({ ...top, url: baseUrl, matchScore: topScore });
  }

  return matched;
}


/** Crawl the live app and collect all unique internal routes (SPA-aware) */
async function discoverRoutes(baseUrl, sessionPath) {
  const browser = await launchBrowser(true);
  const routes = [];
  const origin = new URL(baseUrl).origin;
  const seen = new Set();

  function addRoute(url, text, title = "", heading = "") {
    const clean = url.split("?")[0].split("#")[0];
    if (!clean.startsWith(origin)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    routes.push({ url: clean, text, title, heading });
  }

  try {
    const context = await newContext(browser, sessionPath);
    const page = await context.newPage();

    // Track all URL changes (SPA navigations)
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url().split("?")[0].split("#")[0];
        if (url.startsWith(origin) && !seen.has(url)) {
          seen.add(url);
        }
      }
    });

    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    addRoute(baseUrl, await page.title());

    // Collect all <a href> links (both full URLs and relative paths)
    const hrefLinks = await page.evaluate((origin) => {
      const links = [];
      document.querySelectorAll("a[href]").forEach((a) => {
        const href = a.href || "";
        if (href.startsWith(origin) || href.startsWith("/")) {
          links.push({ href: a.href || (origin + a.getAttribute("href")), text: a.textContent ? a.textContent.trim() : "" });
        }
      });
      return links;
    }, origin);

    for (const l of hrefLinks) addRoute(l.href, l.text);

    // Click through sidebar/nav menu items to discover SPA routes
    const navSelectors = [
      ".ant-menu-item",
      ".ant-menu-submenu-title",
      "[role='menuitem']",
      "nav li",
      ".sidebar-item",
      "[class*='menu-item']",
      "[class*='nav-item']",
    ];

    for (const sel of navSelectors) {
      const items = await page.locator(sel).all();
      for (const item of items.slice(0, 15)) {
        try {
          const text = (await item.textContent() || "").trim();
          if (!text || text.length < 2) continue;
          await item.click({ timeout: 3000 });
          await page.waitForTimeout(800);
          const currentUrl = page.url();
          addRoute(currentUrl, text, "", "");
        } catch { /* skip */ }
      }
      if (routes.length > 15) break;
    }

    // For each discovered route, fetch its page title and heading
    for (const route of routes.slice(1)) {
      try {
        await page.goto(route.url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(600);
        route.title = await page.title();
        route.heading = await page.evaluate(() => {
          const h = document.querySelector("h1, h2, .ant-page-header-heading-title, [class*='page-title']");
          return h ? h.textContent.trim() : "";
        });
      } catch { /* skip */ }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return routes;
}

/** Score how well a live route matches a Figma frame */
function routeFrameScore(route, frame) {
  const frameName = normalize(frame.name);
  const framePage = normalize(frame.page ?? "");

  // Things to compare against
  const candidates = [
    normalize(route.text ?? ""),
    normalize(route.title ?? ""),
    normalize(route.heading ?? ""),
    normalize(urlSlug(route.url)),
  ].filter(Boolean);

  let best = 0;
  for (const candidate of candidates) {
    const s = similarity(frameName, candidate);
    if (s > best) best = s;
    // Also try page name vs candidate
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
  } catch {
    return url;
  }
}

// ─── Node → Element Matching ─────────────────────────────────────────────────

export function matchNodesToElements(figmaNodes, liveElements, frameWidth, frameHeight) {
  const pairs = [];
  const usedLiveIds = new Set();

  const matchableNodes = figmaNodes.filter(
    (n) => n.bbox.w > 10 && n.bbox.h > 10 &&
    !["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "ELLIPSE"].includes(n.type)
  );

  for (const figmaNode of matchableNodes) {
    let bestEl = null;
    let bestScore = 0;

    const fxRel = figmaNode.bbox.x / frameWidth;
    const fyRel = figmaNode.bbox.y / frameHeight;
    const fwRel = figmaNode.bbox.w / frameWidth;
    const fhRel = figmaNode.bbox.h / frameHeight;

    for (const el of liveElements) {
      const id = `${el.bbox.x},${el.bbox.y}`;
      if (usedLiveIds.has(id)) continue;

      const score = matchScore(figmaNode, fxRel, fyRel, fwRel, fhRel, el, frameWidth, frameHeight);
      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    if (bestScore > 0.5 && bestEl) {
      usedLiveIds.add(`${bestEl.bbox.x},${bestEl.bbox.y}`);
      pairs.push({ figmaNode, liveElement: bestEl, score: bestScore });
    } else {
      pairs.push({ figmaNode, liveElement: null, score: 0 });
    }
  }

  const unmatched = liveElements.filter(
    (el) => !usedLiveIds.has(`${el.bbox.x},${el.bbox.y}`)
  );

  return { pairs, unmatchedLive: unmatched };
}

function matchScore(figmaNode, fxRel, fyRel, fwRel, fhRel, liveEl, frameWidth, frameHeight) {
  const scores = [];

  if (figmaNode.text && liveEl.text) {
    const textSim = similarity(normalize(figmaNode.text), normalize(liveEl.text));
    scores.push({ w: 0.5, v: textSim });
  }

  const lxRel = liveEl.bbox.x / frameWidth;
  const lyRel = liveEl.bbox.y / frameHeight;
  const posSim = 1 - Math.min(1, Math.sqrt((fxRel - lxRel) ** 2 + (fyRel - lyRel) ** 2) * 3);
  scores.push({ w: 0.3, v: Math.max(0, posSim) });

  const lwRel = liveEl.bbox.w / frameWidth;
  const lhRel = liveEl.bbox.h / frameHeight;
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
