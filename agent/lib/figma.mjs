/**
 * Figma extraction — 2-stage approach to avoid rate limits.
 *
 * Stage 1: GET /files/{key}?depth=2  →  cheap, just finds frame IDs + bounding boxes
 * Stage 2: GET /files/{key}/nodes?ids={frameIds}  →  targeted, only the frames we need
 *
 * This is far lighter than a single depth=5 whole-file fetch which trips 429s.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";

const BASE          = "https://api.figma.com/v1";
const CACHE_DIR     = join(process.cwd(), ".cache", "figma");
const CACHE_TTL_MS  = 24 * 60 * 60 * 1000;
const INTER_CALL_MS = 800;   // pause between Figma API calls to stay below rate limit

function statMtime(p) { return statSync(p).mtimeMs; }
function headers(token) { return { "X-Figma-Token": token }; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function extractFileKey(url) {
  const m = url.match(/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]+)/);
  if (!m) throw new Error(`Cannot extract Figma file key from: ${url}`);
  return m[1];
}

/** Fetch one URL with exponential-backoff retry on 429. */
async function figmaFetch(url, token) {
  const delays = [5000, 15000, 30000, 60000, 120000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(url, { headers: headers(token) });
    if (res.ok) return res;
    if (res.status !== 429 || attempt === delays.length) {
      throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const wait = delays[attempt];
    console.log(`   Figma 429 — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${delays.length})`);
    await sleep(wait);
  }
  throw new Error("Figma retry budget exhausted");
}

/** Fetch all real frames across all pages. */
export async function fetchFrames(figmaUrl, token) {
  const fileKey = extractFileKey(figmaUrl);
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  // ── Check cache ────────────────────────────────────────────
  const cacheFile = join(CACHE_DIR, `${fileKey}.json`);
  if (existsSync(cacheFile) && Date.now() - statMtime(cacheFile) < CACHE_TTL_MS) {
    console.log("   (using cached Figma frames)");
    return JSON.parse(readFileSync(cacheFile, "utf8"));
  }

  // ── Stage 1: lightweight discovery (depth=2 = pages + top-level frames only) ──
  console.log("   Stage 1: discovering frames (depth=2)…");
  const stageRes = await figmaFetch(`${BASE}/files/${fileKey}?depth=2`, token);
  const stageData = await stageRes.json();
  await sleep(INTER_CALL_MS);

  // Collect qualifying frame IDs
  const candidateIds = [];
  for (const page of stageData.document.children ?? []) {
    for (const node of page.children ?? []) {
      if (node.type !== "FRAME" || node.visible === false) continue;
      if (/^frame\s*\d+$/i.test(node.name.trim())) continue;
      const w = node.absoluteBoundingBox?.width  ?? 0;
      const h = node.absoluteBoundingBox?.height ?? 0;
      if (w < 400 || h < 300) continue;
      candidateIds.push({ id: node.id, name: node.name, page: page.name, w, h });
    }
  }
  console.log(`   Found ${candidateIds.length} candidate frames`);

  if (candidateIds.length === 0) {
    const result = { fileKey, frames: [] };
    writeFileSync(cacheFile, JSON.stringify(result));
    return result;
  }

  // ── Stage 2: targeted node fetch for only those frames ─────
  // Figma /nodes endpoint: returns full subtree for requested node IDs
  const ids = candidateIds.map((f) => f.id).join(",");
  console.log("   Stage 2: fetching frame details (/nodes)…");
  const nodeRes = await figmaFetch(`${BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`, token);
  const nodeData = await nodeRes.json();

  // Build a page-name lookup since /nodes response doesn't include page name
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
    });
  }

  const result = { fileKey, frames };
  writeFileSync(cacheFile, JSON.stringify(result));
  console.log(`   Extracted ${frames.length} frames`);
  return result;
}

/** Export a single frame as PNG. Retries on 429. */
export async function exportFramePng(fileKey, nodeId, token, scale = 1) {
  const res  = await figmaFetch(
    `${BASE}/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${scale}`,
    token
  );
  const data = await res.json();
  const imageUrl = data.images?.[nodeId];
  if (!imageUrl) throw new Error(`No image URL for node ${nodeId}`);
  const imgRes = await fetch(imageUrl);
  return Buffer.from(await imgRes.arrayBuffer());
}

/** Batch-export multiple frames — ONE API call instead of N. */
export async function exportFramesPngBatch(fileKey, nodeIds, token, scale = 1) {
  if (nodeIds.length === 0) return {};
  const res  = await figmaFetch(
    `${BASE}/images/${fileKey}?ids=${encodeURIComponent(nodeIds.join(","))}&format=png&scale=${scale}`,
    token
  );
  const data  = await res.json();
  const result = {};
  await Promise.all(
    Object.entries(data.images ?? {}).map(async ([id, url]) => {
      if (!url) return;
      const buf = await fetch(url).then((r) => r.arrayBuffer());
      result[id] = Buffer.from(buf);
    })
  );
  return result;  // { nodeId: Buffer }
}

// ─── helpers ────────────────────────────────────────────────────────────────

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

function extractInteractions(frameNode, acc = []) {
  walk(frameNode, (n) => {
    if (!n.reactions?.length) return;
    for (const r of n.reactions) {
      if (r.action?.type === "NODE" && r.action.destinationId) {
        acc.push({
          fromNodeName: n.name,
          toFrameId:    r.action.destinationId,
          trigger:      r.trigger?.type ?? "ON_CLICK",
        });
      }
    }
  });
  return acc;
}
