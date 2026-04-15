/**
 * Matching module
 * 1. matchFramesToRoutes  — pair Figma frames to live app URLs
 * 2. matchNodesToElements — pair Figma child nodes to DOM elements
 */

import { launchBrowser, newContext } from "./browser.mjs";

// ─── Frame → Route Matching ───────────────────────────────────────────────────

/**
 * For each Figma frame, find the best matching live URL.
 * Strategy:
 *   1. Collect all internal navigation links from the live app
 *   2. Score each frame name against each link text / href slug
 *   3. If no match, construct URL from frame name (slug fallback)
 */
export async function matchFramesToRoutes(frames, baseUrl, sessionPath) {
  const browser = await launchBrowser(true);
  let navLinks = [];

  try {
    const context = await newContext(browser, sessionPath);
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);

    navLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href], [role='menuitem']")).map((el) => ({
        href: el.href ?? el.getAttribute("data-href") ?? "",
        text: el.textContent?.trim() ?? "",
      })).filter((l) => l.href && l.href.startsWith(window.location.origin))
    );
    await context.close();
  } finally {
    await browser.close();
  }

  return frames.map((frame) => {
    const url = findBestUrl(frame.name, navLinks, baseUrl);
    return { ...frame, url };
  });
}

function findBestUrl(frameName, navLinks, baseUrl) {
  let best = null;
  let bestScore = 0;

  const normalizedFrame = normalize(frameName);

  for (const link of navLinks) {
    // Score against link text
    const textScore = similarity(normalizedFrame, normalize(link.text));
    // Score against URL slug
    const slug = link.href.replace(/.*\//, "").replace(/-/g, " ");
    const slugScore = similarity(normalizedFrame, slug);
    const score = Math.max(textScore, slugScore);

    if (score > bestScore && score > 0.4) {
      bestScore = score;
      best = link.href;
    }
  }

  // Fallback: construct URL from frame name
  if (!best) {
    const slug = frameName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    best = `${baseUrl.replace(/\/$/, "")}/${slug}`;
  }

  return best;
}

// ─── Node → Element Matching ─────────────────────────────────────────────────

/**
 * For each Figma node, find the best matching live DOM element.
 * Returns array of { figmaNode, liveElement, score } pairs.
 * Unmatched Figma nodes have liveElement = null.
 */
export function matchNodesToElements(figmaNodes, liveElements, frameWidth, frameHeight) {
  const pairs = [];
  const usedLiveIds = new Set();

  // Only try to match nodes that are directly useful for style comparison
  const matchableNodes = figmaNodes.filter(
    (n) => n.bbox.w > 10 && n.bbox.h > 10 &&
    !["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "ELLIPSE"].includes(n.type)
  );

  for (const figmaNode of matchableNodes) {
    let bestEl = null;
    let bestScore = 0;

    // Normalize figma position to 0–1 range relative to frame
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

  // Unmatched live elements (present in live but not in Figma)
  const unmatched = liveElements.filter(
    (el) => !usedLiveIds.has(`${el.bbox.x},${el.bbox.y}`)
  );

  return { pairs, unmatchedLive: unmatched };
}

function matchScore(figmaNode, fxRel, fyRel, fwRel, fhRel, liveEl, frameWidth, frameHeight) {
  const scores = [];

  // 1. Text similarity (weight: 0.5)
  if (figmaNode.text && liveEl.text) {
    const textSim = similarity(normalize(figmaNode.text), normalize(liveEl.text));
    scores.push({ w: 0.5, v: textSim });
  }

  // 2. Position similarity (weight: 0.3)
  const lxRel = liveEl.bbox.x / frameWidth;
  const lyRel = liveEl.bbox.y / frameHeight;
  const posSim = 1 - Math.min(1, Math.sqrt((fxRel - lxRel) ** 2 + (fyRel - lyRel) ** 2) * 3);
  scores.push({ w: 0.3, v: Math.max(0, posSim) });

  // 3. Size similarity (weight: 0.2)
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

  // Bigram similarity
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
