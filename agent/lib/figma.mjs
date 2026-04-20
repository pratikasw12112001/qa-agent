/**
 * Figma extraction — 2-stage with persistent gh-pages cache.
 *
 * Cache strategy (avoids repeated API hits):
 *   1. Check raw.githubusercontent.com/{repo}/gh-pages/cache/figma-{key}.json
 *   2. If fresh (<24h), use it — zero Figma API calls
 *   3. On cache miss: fetch from Figma (2 lightweight calls), then write back to gh-pages
 *
 * Figma fetch strategy (rate-limit friendly):
 *   Stage 1: GET /files/{key}?depth=2  →  discover frame IDs only (tiny payload)
 *   Stage 2: GET /files/{key}/nodes?ids={ids}  →  full content for matching frames only
 *   Images:  GET /images/{key}?ids=id1,id2,...  →  one batch call for all frame PNGs
 *
 * Respects Retry-After header — if Figma says "come back in > 5 min", fails immediately
 * with a clear human-readable message instead of burning the retry budget.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";

const FIGMA_BASE      = "https://api.figma.com/v1";
const CACHE_DIR       = join(process.cwd(), ".cache", "figma");
const CACHE_TTL_MS    = 24 * 60 * 60 * 1000;   // 24 h local disk cache
const GH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 24 h gh-pages cache
const INTER_CALL_MS   = 1200;                    // pause between API calls

// GitHub Pages cache (read: no auth; write: needs GH_CACHE_TOKEN + GH_REPO env vars)
const GH_REPO         = process.env.GH_REPO || process.env.GITHUB_REPO || "";
const GH_CACHE_TOKEN  = process.env.GH_CACHE_TOKEN || process.env.GH_TOKEN || "";

function figmaHeaders(token) { return { "X-Figma-Token": token }; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
/** Normalise Figma node ID: URL format "123-456" → API format "123:456" */
export function normalizeNodeId(id) { return String(id ?? "").replace(/-/, ":"); }

export function extractFileKey(url) {
  const m = url.match(/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]+)/);
  if (!m) throw new Error(`Cannot extract Figma file key from: ${url}`);
  return m[1];
}

/** Extract page-id from a Figma URL if present (e.g. ?page-id=123%3A456 or &page-id=123-456) */
export function extractPageId(url) {
  const m = url.match(/[?&]page-id=([^&]+)/);
  if (!m) return null;
  // page-id may be URL-encoded (123%3A456) or dash-separated (123-456)
  return decodeURIComponent(m[1]).replace(/-/, ":");
}

// ── Rate-limit-aware Figma fetch ─────────────────────────────────────────────

async function figmaFetch(url, token) {
  const MAX_IMMEDIATE_WAIT_MS = 5 * 60 * 1000;   // only retry if Retry-After <= 5 min
  const delays = [8000, 20000, 60000, 180000];    // 8s, 20s, 1min, 3min

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(url, { headers: figmaHeaders(token) });
    if (res.ok) return res;

    if (res.status !== 429 || attempt === delays.length) {
      const body = await res.text().catch(() => "");
      throw new Error(`Figma API ${res.status}: ${body.slice(0, 200)}`);
    }

    // Respect Retry-After header
    const retryAfterSec = parseInt(res.headers.get("Retry-After") || "0", 10);
    if (retryAfterSec > 0) {
      const waitMs = retryAfterSec * 1000;
      if (waitMs > MAX_IMMEDIATE_WAIT_MS) {
        const hours = (retryAfterSec / 3600).toFixed(1);
        throw new Error(
          `Figma token is rate-limited for ${hours} more hours (Retry-After: ${retryAfterSec}s). ` +
          `Please generate a new Personal Access Token at https://www.figma.com/settings and update FIGMA_TOKEN.`
        );
      }
      console.log(`   Figma 429 — Retry-After ${retryAfterSec}s, waiting…`);
      await sleep(waitMs + 1000);
    } else {
      const wait = delays[attempt];
      console.log(`   Figma 429 — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${delays.length})`);
      await sleep(wait);
    }
  }
  throw new Error("Figma retry budget exhausted");
}

// ── gh-pages persistent cache ─────────────────────────────────────────────────

async function readGhPagesCache(fileKey) {
  if (!GH_REPO) return null;
  try {
    const url = `https://raw.githubusercontent.com/${GH_REPO}/gh-pages/cache/figma-${fileKey}.json?t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data._cachedAt) return null;
    if (Date.now() - data._cachedAt > GH_CACHE_TTL_MS) {
      console.log("   (gh-pages Figma cache expired)");
      return null;
    }
    console.log("   (using gh-pages Figma cache — no API call needed)");
    return data;
  } catch {
    return null;
  }
}

async function writeGhPagesCache(fileKey, data) {
  if (!GH_REPO || !GH_CACHE_TOKEN) return;
  const path = `cache/figma-${fileKey}.json`;
  const content = Buffer.from(JSON.stringify({ ...data, _cachedAt: Date.now() })).toString("base64");

  try {
    // Check for existing file sha (needed for update)
    let sha;
    const check = await fetch(
      `https://api.github.com/repos/${GH_REPO}/contents/${path}?ref=gh-pages`,
      { headers: { Authorization: `Bearer ${GH_CACHE_TOKEN}`, Accept: "application/vnd.github+json" } }
    );
    if (check.ok) sha = (await check.json()).sha;

    await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GH_CACHE_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `cache: figma ${fileKey}`,
        content,
        branch: "gh-pages",
        ...(sha ? { sha } : {}),
      }),
    });
    console.log("   Figma data cached to gh-pages for future runs");
  } catch (e) {
    console.warn(`   ⚠ gh-pages cache write failed: ${e.message.slice(0, 60)}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchFrames(figmaUrl, token, pageNameFilter = null) {
  const fileKey      = extractFileKey(figmaUrl);
  const pageIdFilter = extractPageId(figmaUrl);   // null = all design pages
  const pageNameNorm = pageNameFilter ? pageNameFilter.trim().toLowerCase() : null;

  if (pageIdFilter) {
    console.log(`   Scoping to page-id: ${pageIdFilter} (from URL)`);
  } else if (pageNameNorm) {
    console.log(`   Scoping to page name: "${pageNameFilter}" (from input)`);
  }

  // Cache key includes page scope so different pages don't collide
  const pageSuffix = pageIdFilter
    ? `--${pageIdFilter.replace(/:/g, "_")}`
    : pageNameNorm
      ? `--name-${pageNameNorm.replace(/[^a-z0-9]/g, "_")}`
      : "";
  const cacheKey = `${fileKey}${pageSuffix}`;

  // 1. Check gh-pages persistent cache first
  const ghCache = await readGhPagesCache(cacheKey);
  if (ghCache?.frames) return { fileKey, frames: ghCache.frames, flowStartingPoints: ghCache.flowStartingPoints ?? [] };

  // 2. Check local disk cache (CI: always miss; local dev: useful)
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const localCache = join(CACHE_DIR, `${cacheKey}.json`);
  if (existsSync(localCache)) {
    const mtime = statSync(localCache).mtimeMs;
    if (Date.now() - mtime < CACHE_TTL_MS) {
      console.log("   (using local disk Figma cache)");
      return JSON.parse(readFileSync(localCache, "utf8"));
    }
  }

  // 3. Fetch from Figma API (2 lightweight calls)
  console.log("   Stage 1: discovering frames (depth=2)…");
  const stage1 = await figmaFetch(`${FIGMA_BASE}/files/${fileKey}?depth=2`, token);
  const stage1Data = await stage1.json();
  await sleep(INTER_CALL_MS);

  // Pages whose names suggest they are not screen designs (component libs, icons, etc.)
  const SKIP_PAGE_RE = /^(component|asset|icon|style|library|archive|draft|template|symbol|_)/i;

  const candidateIds        = [];
  const flowStartingPoints  = [];   // prototype flow entry frames

  for (const page of stage1Data.document.children ?? []) {
    // Filter by page-id (from URL) — exact match
    if (pageIdFilter && page.id !== pageIdFilter) {
      console.log(`   Skipping page "${page.name}" (not the scoped page-id)`);
      continue;
    }
    // Filter by page name (from user input) — case-insensitive partial match
    if (!pageIdFilter && pageNameNorm) {
      const thisPageNorm = page.name.trim().toLowerCase();
      if (!thisPageNorm.includes(pageNameNorm) && !pageNameNorm.includes(thisPageNorm)) {
        console.log(`   Skipping page "${page.name}" (doesn't match "${pageNameFilter}")`);
        continue;
      }
    }
    // Skip known non-design pages when no scope is given
    if (!pageIdFilter && !pageNameNorm && SKIP_PAGE_RE.test(page.name.trim())) {
      console.log(`   Skipping non-design page: "${page.name}"`);
      continue;
    }

    // Collect prototype flow starting points (designer-marked entry frames)
    for (const fsp of page.flowStartingPoints ?? []) {
      if (fsp.nodeId) {
        flowStartingPoints.push({
          nodeId:   normalizeNodeId(fsp.nodeId),
          name:     fsp.name ?? "",
          pageName: page.name,
        });
      }
    }

    for (const node of page.children ?? []) {
      if (node.type !== "FRAME" || node.visible === false) continue;
      if (/^frame\s*\d+$/i.test(node.name.trim())) continue;
      const w = node.absoluteBoundingBox?.width  ?? 0;
      const h = node.absoluteBoundingBox?.height ?? 0;
      if (w < 400 || h < 300) continue;
      candidateIds.push({ id: node.id, name: node.name, page: page.name, w, h });
    }
  }
  if (flowStartingPoints.length) {
    console.log(`   Prototype flow starting points: ${flowStartingPoints.map((f) => `"${f.name}"`).join(", ")}`);
  }
  console.log(`   Found ${candidateIds.length} candidate frames`);

  if (candidateIds.length === 0) {
    const result = { fileKey, frames: [] };
    writeFileSync(localCache, JSON.stringify(result));
    await writeGhPagesCache(cacheKey, result);
    return result;
  }

  const ids = candidateIds.map((f) => f.id).join(",");
  console.log("   Stage 2: fetching frame content (/nodes)…");
  const stage2 = await figmaFetch(
    `${FIGMA_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`,
    token
  );
  const nodeData = await stage2.json();

  const pageByFrameId = {};
  for (const c of candidateIds) pageByFrameId[c.id] = c.page;

  const frames = [];
  for (const [nodeId, nodeWrapper] of Object.entries(nodeData.nodes ?? {})) {
    const node = nodeWrapper?.document;
    if (!node) continue;
    const meta = candidateIds.find((c) => c.id === nodeId);
    if (!meta) continue;
    frames.push({
      id:           nodeId,
      name:         node.name ?? meta.name,
      page:         pageByFrameId[nodeId] ?? "",
      width:        meta.w,
      height:       meta.h,
      textContent:  collectText(node),
      structure:    summarizeStructure(node),
      interactions: extractInteractions(node),
      figmaStyles:  extractFigmaStyles(node),
    });
  }

  const result = { fileKey, frames, flowStartingPoints };
  writeFileSync(localCache, JSON.stringify(result));
  await writeGhPagesCache(cacheKey, result);
  console.log(`   Extracted ${frames.length} frames · ${flowStartingPoints.length} prototype flow(s)`);
  return result;
}

/** Batch-export all frame PNGs — ONE API call. */
export async function exportFramesPngBatch(fileKey, nodeIds, token, scale = 1) {
  if (nodeIds.length === 0) return {};
  const res  = await figmaFetch(
    `${FIGMA_BASE}/images/${fileKey}?ids=${encodeURIComponent(nodeIds.join(","))}&format=png&scale=${scale}`,
    token
  );
  const data  = await res.json();

  // Figma can return 200 with an error body (e.g. "Rate limit exceeded")
  if (data.err) throw new Error(`Figma images API error: ${data.err}`);

  const imageEntries = Object.entries(data.images ?? {});
  const nullUrls = imageEntries.filter(([, u]) => !u).length;
  console.log(`   Figma images response: ${imageEntries.length} URL(s) (${nullUrls} null) for ${nodeIds.length} requested node(s)`);
  if (imageEntries.length === 0) {
    console.warn(`   ⚠ Figma returned empty images object. Full response: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const result = {};
  // Use allSettled so one failed download doesn't abort the entire batch
  await Promise.allSettled(
    imageEntries.map(async ([id, url]) => {
      if (!url) {
        console.warn(`   ⚠ No URL for node ${id} (Figma returned null)`);
        return;
      }
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const buf = await r.arrayBuffer();
        result[id] = Buffer.from(buf);
      } catch (e) {
        console.warn(`   ⚠ PNG download failed for ${id}: ${e.message.slice(0, 80)}`);
      }
    })
  );
  console.log(`   Downloaded ${Object.keys(result).length}/${imageEntries.length} PNG(s)`);
  return result;
}

// ── Legacy single-frame export (used as fallback) ─────────────────────────────
export async function exportFramePng(fileKey, nodeId, token, scale = 1) {
  const batch = await exportFramesPngBatch(fileKey, [nodeId], token, scale);
  const buf = batch[nodeId];
  if (!buf) throw new Error(`No image returned for node ${nodeId}`);
  return buf;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectText(node, acc = []) {
  if (!node || node.visible === false) return acc;
  if (node.type === "TEXT" && node.characters) acc.push(node.characters.trim());
  for (const child of node.children ?? []) collectText(child, acc);
  return acc;
}

function summarizeStructure(node) {
  const counts = { text: 0, button: 0, input: 0, image: 0, rect: 0, group: 0, total: 0 };
  walk(node, (n) => {
    counts.total++;
    const name = (n.name || "").toLowerCase();
    if (n.type === "TEXT") counts.text++;
    else if (n.type === "RECTANGLE") counts.rect++;
    else if (n.type === "GROUP" || n.type === "FRAME") counts.group++;
    else if (n.type === "COMPONENT" || n.type === "INSTANCE") {
      if (name.includes("button") || name.includes("btn")) counts.button++;
      else if (name.includes("input")  || name.includes("field")) counts.input++;
    }
    if (n.fills?.some((f) => f.type === "IMAGE")) counts.image++;
  });
  return counts;
}

function walk(node, fn, depth = 0) {
  if (!node || node.visible === false || depth > 8) return;
  fn(node);
  for (const c of node.children ?? []) walk(c, fn, depth + 1);
}

/**
 * Extracts major style properties from a Figma frame's node tree.
 * Returns categorised style samples: buttons, headings, inputs, bodyText.
 * Only captures: fontSize, fontWeight, fontFamily, color, backgroundColor,
 * padding (auto-layout), borderRadius.
 */
function extractFigmaStyles(frameNode) {
  const result = { buttons: [], headings: [], inputs: [], bodyText: [] };

  function rgbaToHex({ r, g, b, a = 1 }) {
    const hex = [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
    return a < 0.99 ? `#${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}` : `#${hex}`;
  }

  function getFillColor(fills) {
    if (!fills?.length) return null;
    const solid = fills.find(f => f.type === "SOLID" && f.visible !== false);
    if (!solid?.color) return null;
    return rgbaToHex(solid.color);
  }

  function nodeStyles(n) {
    const s = {};
    // Typography
    if (n.style?.fontSize)    s.fontSize    = `${n.style.fontSize}px`;
    if (n.style?.fontWeight)  s.fontWeight  = String(n.style.fontWeight);
    if (n.style?.fontFamily)  s.fontFamily  = n.style.fontFamily;
    if (n.style?.lineHeightPx) s.lineHeight = `${Math.round(n.style.lineHeightPx)}px`;
    // Color (text fill)
    const textColor = getFillColor(n.fills);
    if (textColor) s.color = textColor;
    // Background (frame/component fills)
    const bgColor = n.type !== "TEXT" ? getFillColor(n.fills) : null;
    if (bgColor) s.backgroundColor = bgColor;
    // Padding (auto-layout)
    if (n.paddingTop    != null) s.paddingTop    = `${n.paddingTop}px`;
    if (n.paddingRight  != null) s.paddingRight  = `${n.paddingRight}px`;
    if (n.paddingBottom != null) s.paddingBottom = `${n.paddingBottom}px`;
    if (n.paddingLeft   != null) s.paddingLeft   = `${n.paddingLeft}px`;
    // Border radius
    if (n.cornerRadius  != null && n.cornerRadius > 0) s.borderRadius = `${n.cornerRadius}px`;
    return s;
  }

  const nameLower = (n) => (n.name || "").toLowerCase();

  // Pass 1: name-heuristic walk (text nodes, named components)
  walk(frameNode, (n) => {
    const name   = nameLower(n);
    const isButton  = name.includes("button") || name.includes("btn") || name.includes("cta");
    const isHeading = name.includes("heading") || name.includes("title") || name.includes("header");
    const isInput   = name.includes("input")   || name.includes("field") || name.includes("textfield");
    const isText    = n.type === "TEXT";

    const styles = nodeStyles(n);
    if (!Object.keys(styles).length) return;

    if (isButton  && result.buttons.length  < 3) result.buttons.push ({ label: n.name, styles });
    else if (isHeading && result.headings.length < 2) result.headings.push({ label: n.name, styles });
    else if (isInput   && result.inputs.length   < 2) result.inputs.push  ({ label: n.name, styles });
    else if (isText && result.bodyText.length < 1 && n.style?.fontSize && n.style.fontSize < 16)
      result.bodyText.push({ label: (n.characters || n.name || "").slice(0, 30), styles });
  });

  // Pass 2: INSTANCE / COMPONENT nodes — where real design tokens live.
  // These are named things like "Primary/Large/Default", "Form field/Text",
  // so name heuristics miss them. Detect by structure instead:
  //   button:  has padding + cornerRadius + a solid fill + a TEXT child
  //   input:   has strokeWeight > 0 + a TEXT child with placeholder-style text
  //   heading: TEXT child with fontSize >= 20
  walk(frameNode, (n) => {
    if (n.type !== "INSTANCE" && n.type !== "COMPONENT") return;

    const baseStyles = nodeStyles(n);

    // Merge in TEXT child typography (most specific — actual font tokens)
    const textChild = (n.children ?? []).find(c => c.type === "TEXT" && c.style?.fontSize);
    if (textChild) Object.assign(baseStyles, nodeStyles(textChild));

    if (!Object.keys(baseStyles).length) return;

    const hasPadding  = n.paddingTop != null && n.paddingTop >= 0;
    const hasRadius   = (n.cornerRadius ?? 0) > 0;
    const hasFill     = (n.fills ?? []).some(f => f.type === "SOLID" && f.visible !== false);
    const hasStroke   = (n.strokeWeight ?? 0) > 0;
    const textFontSz  = textChild?.style?.fontSize ?? 0;

    const looksLikeButton  = hasPadding && hasRadius && hasFill;
    const looksLikeInput   = hasStroke && hasPadding && !hasRadius;
    const looksLikeHeading = textFontSz >= 20;

    if      (looksLikeButton  && result.buttons.length  < 3) result.buttons.push ({ label: n.name, styles: baseStyles });
    else if (looksLikeInput   && result.inputs.length   < 2) result.inputs.push  ({ label: n.name, styles: baseStyles });
    else if (looksLikeHeading && result.headings.length < 2) result.headings.push({ label: n.name, styles: baseStyles });
  });

  return result;
}

function extractInteractions(frameNode, acc = []) {
  walk(frameNode, (n) => {
    if (!n.reactions?.length) return;

    // Collect visible text label from direct TEXT children — this is what the
    // user actually sees on the button/element (e.g. "Create new Logbook")
    const fromNodeLabel = (n.children ?? [])
      .filter(c => c.type === "TEXT" && c.characters?.trim())
      .map(c => c.characters.trim())
      .join(" ")
      .trim() || null;

    for (const r of n.reactions) {
      if (r.action?.type === "NODE" && r.action.destinationId) {
        acc.push({
          fromNodeName:  n.name,
          fromNodeLabel,          // visible button text — used for trigger matching
          toFrameId:     r.action.destinationId,
          trigger:       r.trigger?.type ?? "ON_CLICK",
        });
      }
    }
  });
  return acc;
}
