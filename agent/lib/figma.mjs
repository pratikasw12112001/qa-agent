/**
 * Figma extraction.
 *
 * For each real frame in the file:
 *   - Export PNG
 *   - Extract text content (for text-match signal)
 *   - Extract structure summary (for structure-match signal)
 *   - Extract prototype interactions (for functional test generation)
 */

const BASE = "https://api.figma.com/v1";

function headers(token) { return { "X-Figma-Token": token }; }

export function extractFileKey(url) {
  const m = url.match(/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]+)/);
  if (!m) throw new Error(`Cannot extract Figma file key from: ${url}`);
  return m[1];
}

/** Fetch all "real" frames across all pages. */
export async function fetchFrames(figmaUrl, token) {
  const fileKey = extractFileKey(figmaUrl);
  const res = await fetch(`${BASE}/files/${fileKey}?depth=5`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();

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
  const res = await fetch(
    `${BASE}/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${scale}`,
    { headers: headers(token) }
  );
  if (!res.ok) throw new Error(`Figma export ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
