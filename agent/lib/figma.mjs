/**
 * Figma extraction.
 *
 * For each real frame in the file:
 *   - Export PNG
 *   - Extract text content (for text-match signal)
 *   - Extract structure summary (for structure-match signal)
 *   - Extract prototype interactions (for functional test generation)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";

function statMtime(p) { return statSync(p).mtimeMs; }

const BASE = "https://api.figma.com/v1";
const CACHE_DIR = join(process.cwd(), ".cache", "figma");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function headers(token) { return { "X-Figma-Token": token }; }

export function extractFileKey(url) {
  const m = url.match(/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]+)/);
  if (!m) throw new Error(`Cannot extract Figma file key from: ${url}`);
  return m[1];
}

/** Fetch with retry on 429 (exponential backoff). */
async function figmaFetch(url, token) {
  const delays = [2000, 5000, 12000, 30000, 60000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(url, { headers: headers(token) });
    if (res.ok) return res;
    if (res.status !== 429 || attempt === delays.length) {
      throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const wait = delays[attempt];
    console.log(`   Figma 429 — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${delays.length})`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error("Figma retry budget exhausted");
}

/** Fetch all "real" frames across all pages. */
export async function fetchFrames(figmaUrl, token) {
  const fileKey = extractFileKey(figmaUrl);

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${fileKey}.json`);
  let data;
  if (existsSync(cacheFile) && Date.now() - statMtime(cacheFile) < CACHE_TTL_MS) {
    console.log("   (using cached Figma file response)");
    data = JSON.parse(readFileSync(cacheFile, "utf8"));
  } else {
    const res = await figmaFetch(`${BASE}/files/${fileKey}?depth=5`, token);
    data = await res.json();
    writeFileSync(cacheFile, JSON.stringify(data));
  }

  const frames = [];
  for (const page of data.document.children ?? []) {
    for (const node of page.children ?? []) {
      if (node.type !== "FRAME" || node.visible === false) continue;

      // Skip default-named frames
      if (/^frame\s*\d+$/i.test(node.name.trim())) continue;

      const w = node.absoluteBoundingBox?.width ?? 0;
      const h = node.absoluteBoundingBox?.height ?? 0;
      // Skip tiny frames (icons, components)
      if (w < 400 || h < 300) continue;

      const textContent = collectText(node);
      const structure = summarizeStructure(node);

      frames.push({
        id: node.id,
        name: node.name,
        page: page.name,
        width: w,
        height: h,
        textContent,
        structure,
        interactions: extractInteractions(node),
      });
    }
  }

  return { fileKey, frames };
}

/** Export a single frame as a PNG buffer. */
export async function exportFramePng(fileKey, nodeId, token, scale = 1) {
  const res = await figmaFetch(
    `${BASE}/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${scale}`,
    token
  );
  const data = await res.json();
  const imageUrl = data.images?.[nodeId];
  if (!imageUrl) throw new Error(`No image URL for node ${nodeId}`);
  const imgRes = await fetch(imageUrl);
  return Buffer.from(await imgRes.arrayBuffer());
}

// ─── internals ──────────────────────────────────────────────────────────────

/** All TEXT characters in the frame, concatenated (used for text-match signal). */
function collectText(node, acc = []) {
  if (!node || node.visible === false) return acc;
  if (node.type === "TEXT" && node.characters) acc.push(node.characters.trim());
  for (const child of node.children ?? []) collectText(child, acc);
  return acc;
}

/** Ratio summary of structural node types — used for structure-match signal. */
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
      else if (name.includes("input") || name.includes("field")) counts.input++;
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

/** Prototype interactions: [{ fromNodeName, toFrameId, trigger }] */
function extractInteractions(frameNode, acc = []) {
  walk(frameNode, (n) => {
    if (!n.reactions?.length) return;
    for (const r of n.reactions) {
      if (r.action?.type === "NODE" && r.action.destinationId) {
        acc.push({
          fromNodeName: n.name,
          toFrameId: r.action.destinationId,
          trigger: r.trigger?.type ?? "ON_CLICK",
        });
      }
    }
  });
  return acc;
}
