/**
 * Figma API client
 * - Auto-detects all top-level frames from a file URL
 * - Exports frames as PNG
 * - Extracts style tree for comparison
 * - Reads prototype interactions for functional tests
 */

const BASE = "https://api.figma.com/v1";

function headers(token) {
  return { "X-Figma-Token": token };
}

/** Extract file key from any Figma URL */
export function extractFileKey(url) {
  const m = url.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
  if (!m) throw new Error(`Cannot extract Figma file key from: ${url}`);
  return m[1];
}

/** Get all top-level frames across all pages */
export async function detectFrames(figmaFileUrl, token) {
  const fileKey = extractFileKey(figmaFileUrl);
  const res = await fetch(`${BASE}/files/${fileKey}?depth=3`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Figma API error ${res.status}: ${await res.text()}`);
  const data = await res.json();

  const frames = [];
  for (const page of data.document.children ?? []) {
    for (const node of page.children ?? []) {
      if (node.type === "FRAME" && node.visible !== false) {
        // Skip auto-named frames like "Frame 1234" — they are not real screens
        if (/^frame\s*\d+$/i.test(node.name.trim())) continue;
        frames.push({
          id: node.id,
          name: node.name,
          page: page.name,
          width: node.absoluteBoundingBox?.width ?? 1440,
          height: node.absoluteBoundingBox?.height ?? 900,
          children: flattenNodes(node),
          interactions: extractInteractions(node),
        });
      }
    }
  }

  console.log(`  Figma: found ${frames.length} frames across ${data.document.children.length} pages`);
  return { fileKey, frames };
}

/** Export a frame as PNG buffer (2× scale) */
export async function exportFramePng(fileKey, nodeId, token, scale = 2) {
  const res = await fetch(
    `${BASE}/images/${fileKey}?ids=${nodeId}&format=png&scale=${scale}`,
    { headers: headers(token) }
  );
  if (!res.ok) throw new Error(`Figma export error ${res.status}`);
  const data = await res.json();
  const imageUrl = data.images?.[nodeId];
  if (!imageUrl) throw new Error(`No image URL for node ${nodeId}`);

  const imgRes = await fetch(imageUrl);
  return Buffer.from(await imgRes.arrayBuffer());
}

/** Get full style data for a specific node */
export async function getNodeStyles(fileKey, nodeId, token) {
  const res = await fetch(`${BASE}/files/${fileKey}/nodes?ids=${nodeId}&depth=5`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Figma nodes error ${res.status}`);
  const data = await res.json();
  const node = data.nodes?.[nodeId]?.document;
  if (!node) return null;
  return flattenNodes(node);
}

// ─── Internals ───────────────────────────────────────────────────────────────

/** Walk node tree, collect all visible nodes with meaningful styles */
function flattenNodes(node, depth = 0) {
  if (!node || node.visible === false || depth > 8) return [];
  const result = [normalizeNode(node)];
  for (const child of node.children ?? []) {
    result.push(...flattenNodes(child, depth + 1));
  }
  return result;
}

function normalizeNode(node) {
  const bbox = node.absoluteBoundingBox
    ? { x: node.absoluteBoundingBox.x, y: node.absoluteBoundingBox.y,
        w: node.absoluteBoundingBox.width, h: node.absoluteBoundingBox.height }
    : { x: 0, y: 0, w: 0, h: 0 };

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    bbox,
    text: node.characters ?? null,
    styles: {
      fontFamily: node.style?.fontFamily ?? null,
      fontSize: node.style?.fontSize ?? null,
      fontWeight: node.style?.fontWeight ?? null,
      lineHeight: node.style?.lineHeightPx ?? null,
      letterSpacing: node.style?.letterSpacing ?? null,
      backgroundColor: solidFill(node.fills),
      color: node.type === "TEXT" ? solidFill(node.fills) : null,
      borderColor: solidFill(node.strokes),
      borderWidth: node.strokeWeight ?? null,
      borderRadius: node.cornerRadius ?? node.rectangleCornerRadii?.[0] ?? null,
      boxShadow: buildBoxShadow(node.effects),
      opacity: node.opacity ?? 1,
      paddingTop: node.paddingTop ?? null,
      paddingRight: node.paddingRight ?? null,
      paddingBottom: node.paddingBottom ?? null,
      paddingLeft: node.paddingLeft ?? null,
      gap: node.itemSpacing ?? null,
    },
  };
}

function solidFill(fills) {
  if (!fills?.length) return null;
  const f = fills.find((f) => f.type === "SOLID" && f.visible !== false);
  if (!f?.color) return null;
  const { r, g, b, a } = f.color;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a.toFixed(3)})`;
}

function buildBoxShadow(effects) {
  if (!effects?.length) return null;
  const shadows = effects.filter(
    (e) => (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.visible !== false
  );
  if (!shadows.length) return null;
  return shadows
    .map((s) => {
      const inset = s.type === "INNER_SHADOW" ? "inset " : "";
      const col = s.color
        ? `rgba(${Math.round(s.color.r*255)},${Math.round(s.color.g*255)},${Math.round(s.color.b*255)},${s.color.a.toFixed(2)})`
        : "rgba(0,0,0,0.25)";
      return `${inset}${s.offset?.x ?? 0}px ${s.offset?.y ?? 0}px ${s.radius ?? 0}px ${col}`;
    })
    .join(", ");
}

/** Extract prototype click interactions: [{fromNodeId, fromNodeName, toFrameId, toFrameName, trigger}] */
function extractInteractions(frameNode, acc = []) {
  if (!frameNode) return acc;
  const node = frameNode;
  if (node.reactions?.length) {
    for (const reaction of node.reactions) {
      if (reaction.action?.type === "NODE" && reaction.action?.destinationId) {
        acc.push({
          fromNodeId: node.id,
          fromNodeName: node.name,
          toFrameId: reaction.action.destinationId,
          trigger: reaction.trigger?.type ?? "ON_CLICK",
        });
      }
    }
  }
  for (const child of node.children ?? []) {
    extractInteractions(child, acc);
  }
  return acc;
}
