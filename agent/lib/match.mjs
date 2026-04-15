/**
 * Matching module
 * 1. matchFramesToRoutes  — pair Figma frames to live app URLs
 * 2. matchNodesToElements — pair Figma child nodes to DOM elements
 */

import { launchBrowser, newContext } from "./browser.mjs";

const MAX_SCREENS = 8; // test at most 8 screens per run

// ─── Frame → Route Matching ───────────────────────────────────────────────────

/**
 * Crawl the live app to discover real routes, then match each route
 * to the best Figma frame by name similarity.
 * Only returns pairs where a genuine match exists.
 */
export async function matchFramesToRoutes(frames, baseUrl, sessionPath) {
  // Step 1: discover real routes in the live app
  const routes = await discoverRoutes(baseUrl, sessionPath);
  console.log(`   Discovered ${routes.length} real routes in the live app`);

  // Step 2: for each route, find the best Figma frame
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

    if (best && bestScore >= 0.35) {
      usedFrameIds.add(best.id);
      matched.push({ ...best, url: route.url, matchScore: bestScore });
      console.log(`   [${bestScore.toFixed(2)}] "${best.name}" → ${route.url}`);
    }

    if (matched.length >= MAX_SCREENS) break;
  }

  // If we got nothing, fall back: use the base URL with the top frame
  if (matched.length === 0 && frames.length > 0) {
    const top = frames[0];
    console.log(`   No route matches found — using base URL with first frame`);
    matched.push({ ...top, url: baseUrl, matchScore: 0 });
  }

  return matched;
}

/** Crawl the live app and collect all unique internal routes */
async function discoverRoutes(baseUrl, sessionPath) {
  const browser = await launchBrowser(true);
  const routes = [];
  const origin = new URL(baseUrl).origin;

  try {
    const context = await newContext(browser, sessionPath);
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Collect links + page title from the root page
    const rootLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll("a[href]").forEach((a) => {
        if (a.href && a.href.startsWith(window.location.origin)) {
          links.push({
            url: a.href.split("?")[0].split("#")[0],
            text: a.textContent ? a.textContent.trim() : "",
          });
        }
      });
      // Also check sidebar/nav items
      document.querySelectorAll(
        "[role='menuitem'], .ant-menu-item, .ant-menu-submenu-title, nav a, sidebar a, .sidebar a"
      ).forEach((el) => {
        const href = el.href || el.getAttribute("data-href") || "";
        if (href && href.startsWith(window.location.origin)) {
          links.push({
            url: href.split("?")[0].split("#")[0],
            text: el.textContent ? el.textContent.trim() : "",
          });
        }
      });
      return links;
    });

    // Add root page itself
    routes.push({ url: baseUrl, text: await page.title() });

    // Deduplicate and add discovered links
    const seen = new Set([baseUrl]);
    for (const link of rootLinks) {
      if (!seen.has(link.url) && link.url.startsWith(origin) && link.url !== baseUrl) {
        seen.add(link.url);
        routes.push(link);
      }
    }

    // Visit each link to get page title for better matching
    for (const route of routes.slice(1, 20)) {
      try {
        await page.goto(route.url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(500);
        route.title = await page.title();
        // Also collect h1/h2 heading text
        route.heading = await page.evaluate(() => {
          const h = document.querySelector("h1, h2, .ant-page-header-heading-title");
          return h ? h.textContent.trim() : "";
        });
      } catch {
        // skip if navigation fails
      }
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
