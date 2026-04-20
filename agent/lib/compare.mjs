/**
 * Visual + content comparison between a matched (live state, figma frame) pair.
 *
 * Produces:
 *   - findings[]: flat list { category, severity, description, evidence }
 *   - analysis:   7-dimension breakdown:
 *       Layout & Structure, Typography, Colors, Component Styling,
 *       Icons & Assets, Interactions & States, Content Accuracy
 *     Each dimension: { score 0-100, status matches|partial|deviates, notes, issues[] }
 *   - frameScore: 0-100 overall fidelity score
 *   - summary: 1-2 sentence overall assessment
 */

import { askVision, parseJsonLoose } from "./ai.mjs";

const DIMENSIONS = [
  "layoutStructure",
  "typography",
  "colors",
  "componentStyling",
  "iconsAssets",
  "interactionsStates",
  "contentAccuracy",
];

export async function compareStateToFrame({ state, match, frame }) {
  const findings = [];
  let analysis   = null;

  if (!match.frameId) {
    findings.push({
      category: "match", severity: "warn",
      description: `State "${state.id}" could not be matched to any Figma frame`,
      evidence: `confidence: ${(match.confidence ?? 0).toFixed(2)}`,
    });
    return { findings, analysis };
  }

  // 1. Free deterministic check: text presence
  findings.push(...presenceChecks(state, frame));

  // 1b. CSS property comparison (deterministic, no AI call)
  findings.push(...cssComparison(state.cssProperties, frame.figmaStyles));

  // 2. Deep 7-dimension AI analysis (one vision call — full screen)
  if (match.framePng) {
    analysis = await visionAnalysis(state.screenshot, match.framePng, frame.name);
  } else {
    // No PNG — produce a text-only analysis stub
    analysis = textOnlyAnalysis(state, frame);
  }

  // Flatten dimension issues into findings for the existing findings section
  if (analysis?.dimensions) {
    for (const [dimKey, dim] of Object.entries(analysis.dimensions)) {
      if (!dim || dim.status === "matches") continue;
      const sev = dim.status === "deviates" ? "error" : "warn";
      for (const issue of (dim.issues ?? []).slice(0, 3)) {
        findings.push({
          category: dimKey,
          severity: sev,
          description: issue,
          evidence: frame.name,
        });
      }
    }
  }

  // 3. Focused cropped-region vision (up to 2 crops — catches typography & spacing at 5-10x zoom)
  if (match.framePng && state.croppedRegions?.length) {
    const focusedIssues = await focusedRegionVision(state.croppedRegions, match.framePng, frame.name);
    for (const issue of focusedIssues) {
      findings.push({ category: "focused-vision", severity: "warn", description: issue, evidence: frame.name });
    }
  }

  return { findings, analysis };
}

// ─── CSS property comparison ──────────────────────────────────────────────────
/**
 * Compares live computed CSS values against Figma design tokens.
 * Produces findings only for meaningful deviations (e.g. font-size off by >2px,
 * padding off by >4px, color differs).
 * Reports exact values: "Button 'Save': font-size is 14px in live, 16px in Figma"
 */
function cssComparison(liveCss, figmaStyles) {
  const findings = [];
  if (!liveCss || !figmaStyles) return findings;

  const categories = [
    { key: "buttons",  label: "Button" },
    { key: "headings", label: "Heading" },
    { key: "inputs",   label: "Input" },
    { key: "bodyText", label: "Body text" },
  ];

  for (const { key, label } of categories) {
    const liveItems  = liveCss[key]  ?? [];
    const figmaItems = figmaStyles[key] ?? [];
    if (!liveItems.length || !figmaItems.length) continue;

    // Best-match pairing by label token overlap — avoids mis-pairing
    // "Cancel" button (live) with "Submit CTA" (figma)
    const pairs = bestMatchPairs(liveItems, figmaItems);
    for (const { live, figma } of pairs) {
      const elLabel = live.label || figma.label || label;
      const diffs = diffStyles(live.styles, figma.styles);
      for (const d of diffs) {
        findings.push({
          category: "css",
          severity: d.severity,
          description: `${label} "${elLabel}": ${d.prop} is ${d.live} in live, ${d.figma} in Figma`,
          evidence: `${label.toLowerCase()} css deviation`,
        });
      }
    }
  }

  return findings;
}

/**
 * Compares two style objects and returns meaningful deviations.
 * Numeric values: flag if diff > threshold. Colors: flag if different.
 */
function diffStyles(live, figma) {
  if (!live || !figma) return [];
  const diffs = [];

  // Font size — threshold 2px
  if (live.fontSize && figma.fontSize) {
    const lv = parseFloat(live.fontSize);
    const fv = parseFloat(figma.fontSize);
    if (!isNaN(lv) && !isNaN(fv) && Math.abs(lv - fv) > 2) {
      diffs.push({ prop: "font-size", live: live.fontSize, figma: figma.fontSize,
        severity: Math.abs(lv - fv) > 4 ? "error" : "warn" });
    }
  }

  // Font weight
  if (live.fontWeight && figma.fontWeight && live.fontWeight !== figma.fontWeight) {
    diffs.push({ prop: "font-weight", live: live.fontWeight, figma: figma.fontWeight, severity: "warn" });
  }

  // Color (text) — compare hex/rgb loosely
  if (live.color && figma.color) {
    const lc = normalizeColor(live.color);
    const fc = normalizeColor(figma.color);
    if (lc && fc && !colorsClose(lc, fc, 20)) {
      diffs.push({ prop: "color", live: live.color, figma: figma.color, severity: "warn" });
    }
  }

  // Background color
  if (live.backgroundColor && figma.backgroundColor) {
    const lc = normalizeColor(live.backgroundColor);
    const fc = normalizeColor(figma.backgroundColor);
    if (lc && fc && !colorsClose(lc, fc, 20)) {
      diffs.push({ prop: "background-color", live: live.backgroundColor, figma: figma.backgroundColor, severity: "warn" });
    }
  }

  // Padding (vertical = top+bottom, horizontal = left+right) — threshold 4px
  const livePadV  = (parseFloat(live.paddingTop  ||"0") + parseFloat(live.paddingBottom||"0"));
  const figmaPadV = (parseFloat(figma.paddingTop ||"0") + parseFloat(figma.paddingBottom||"0"));
  if (figma.paddingTop && Math.abs(livePadV - figmaPadV) > 4) {
    diffs.push({ prop: "padding-vertical", live: `${parseFloat(live.paddingTop||"0")}px / ${parseFloat(live.paddingBottom||"0")}px`,
      figma: `${parseFloat(figma.paddingTop||"0")}px / ${parseFloat(figma.paddingBottom||"0")}px`, severity: "warn" });
  }

  const livePadH  = (parseFloat(live.paddingLeft ||"0") + parseFloat(live.paddingRight ||"0"));
  const figmaPadH = (parseFloat(figma.paddingLeft||"0") + parseFloat(figma.paddingRight ||"0"));
  if (figma.paddingLeft && Math.abs(livePadH - figmaPadH) > 4) {
    diffs.push({ prop: "padding-horizontal", live: `${parseFloat(live.paddingLeft||"0")}px / ${parseFloat(live.paddingRight||"0")}px`,
      figma: `${parseFloat(figma.paddingLeft||"0")}px / ${parseFloat(figma.paddingRight||"0")}px`, severity: "warn" });
  }

  // Border radius — threshold 4px
  if (live.borderRadius && figma.borderRadius) {
    const lr = parseFloat(live.borderRadius);
    const fr = parseFloat(figma.borderRadius);
    if (!isNaN(lr) && !isNaN(fr) && Math.abs(lr - fr) > 4) {
      diffs.push({ prop: "border-radius", live: live.borderRadius, figma: figma.borderRadius, severity: "warn" });
    }
  }

  return diffs;
}

// ─── Label-based pairing ──────────────────────────────────────────────────────
/**
 * For each live element, find the best-matching figma element by label token
 * overlap. Avoids mis-pairing "Cancel" (live) with "Submit CTA" (figma).
 * Unmatched elements are skipped rather than force-paired.
 */
function bestMatchPairs(liveItems, figmaItems) {
  const pairs = [];
  const usedFigmaIdx = new Set();

  for (const live of liveItems) {
    const liveToks = labelTokens(live.label || "");
    let bestScore = -1;
    let bestIdx   = -1;

    for (let j = 0; j < figmaItems.length; j++) {
      if (usedFigmaIdx.has(j)) continue;
      const figToks = labelTokens(figmaItems[j].label || "");
      const score   = labelOverlap(liveToks, figToks);
      if (score > bestScore) { bestScore = score; bestIdx = j; }
    }

    // Accept if: some token overlap, OR only one figma item (no choice), OR
    // live label is empty (unlabelled element — pair with first available figma)
    const accept = bestIdx >= 0 && (
      bestScore > 0 ||
      figmaItems.length === 1 ||
      !live.label
    );

    if (accept) {
      pairs.push({ live, figma: figmaItems[bestIdx] });
      usedFigmaIdx.add(bestIdx);
    }
  }
  return pairs;
}

function labelTokens(s) {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 1)
  );
}

function labelOverlap(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let hits = 0;
  for (const w of setA) if (setB.has(w)) hits++;
  return hits / Math.max(setA.size, setB.size);
}

// ─── Focused cropped-region vision ────────────────────────────────────────────
/**
 * Runs a second, targeted vision call using cropped live regions (header,
 * primary-action area) vs the full Figma frame. The 5-10x zoom makes font
 * sizes, padding, and spacing deviations visible to the model.
 * Returns an array of issue description strings (max 4 total).
 */
async function focusedRegionVision(croppedRegions, figmaB64, frameName) {
  if (!croppedRegions?.length) return [];
  const regionLabels = croppedRegions.map(r => r.label).join(" and ");
  const system =
    "You are a pixel-level UI QA engineer. You are given cropped live-app regions and the full Figma design frame. " +
    "Find specific visual deviations that a full-screen comparison would miss. Be precise with measurements.";
  const user =
    `Carefully compare the CROPPED LIVE regions (${regionLabels}) against the FIGMA frame "${frameName}". ` +
    `Focus on: font-size differences, wrong padding/spacing, wrong colors, wrong border-radius, wrong font-weight. ` +
    `Ignore dynamic data (names, dates, counts). ` +
    `Reply JSON only: { "issues": ["<specific issue with exact values e.g. button padding is 8px live vs 12px Figma>"] }. Max 4 issues.`;

  const images = [
    ...croppedRegions.map(r => ({ label: `LIVE_${r.label.replace(/-/g, "_").toUpperCase()}`, base64: r.screenshot })),
    { label: "FIGMA_FULL", base64: figmaB64 },
  ];

  try {
    const raw = await askVision(system, user, images, { json: true });
    const j   = parseJsonLoose(raw);
    return Array.isArray(j?.issues) ? j.issues.slice(0, 4) : [];
  } catch {
    return [];
  }
}

// ─── Alpha-aware color helpers ────────────────────────────────────────────────
/**
 * Parse hex or rgb(a) color to {r, g, b, a} where a ∈ [0,1].
 * Returns null for fully transparent colors (a < 0.05) — no useful signal.
 */
function normalizeColor(c) {
  if (!c || c === "transparent") return null;

  // rgba(r,g,b,a)
  const rgba = c.match(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/);
  if (rgba) {
    const a = parseFloat(rgba[4]);
    if (a < 0.05) return null;   // fully transparent — skip
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a };
  }
  // rgb(r,g,b)
  const rgb = c.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: 1 };

  // #rrggbbaa
  const hex8 = c.match(/^#([0-9a-f]{8})/i);
  if (hex8) {
    const h = hex8[1];
    const a = parseInt(h.slice(6, 8), 16) / 255;
    if (a < 0.05) return null;
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a };
  }
  // #rrggbb
  const hex6 = c.match(/^#([0-9a-f]{6})/i);
  if (hex6) {
    const h = hex6[1];
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: 1 };
  }
  // #rgb
  const hex3 = c.match(/^#([0-9a-f]{3})/i);
  if (hex3) {
    const h = hex3[1];
    return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16), a: 1 };
  }
  return null;
}

/**
 * Returns true if two RGBA colors are perceptually the same.
 * RGB Euclidean distance must be within `threshold`.
 * Alpha difference > 0.15 is treated as a meaningful intent difference.
 */
function colorsClose(c1, c2, threshold) {
  const rgbDist = Math.sqrt((c1.r-c2.r)**2 + (c1.g-c2.g)**2 + (c1.b-c2.b)**2);
  if (rgbDist > threshold) return false;
  const alphaDiff = Math.abs((c1.a ?? 1) - (c2.a ?? 1));
  return alphaDiff <= 0.15;   // same RGB but very different opacity = different intent
}

// ─── presence checks (lenient) ───────────────────────────────────────────────
// Only flags meaningful multi-word content — not single labels, ALL-CAPS headings,
// or UI chrome that legitimately varies between design and live.

function presenceChecks(state, frame) {
  const findings = [];
  const liveTexts = new Set(
    (state.textContent || []).map((s) => String(s).toLowerCase().replace(/\s+/g, " ").trim())
  );

  // Filter Figma texts to only significant content:
  // - Must have at least 2 words (a space) → filters out single labels
  // - Min 8 chars, max 120 chars
  // - Skip ALL CAPS (design labels, section headers)
  // - Skip strings ending in ":" (form field labels like "Name:", "Email:")
  // - Skip placeholder-style text like "[Name]" or "(optional)"
  const figmaTexts = (frame.textContent || [])
    .map((s) => String(s).trim())
    .filter((s) => {
      if (s.length < 8 || s.length > 120) return false;
      if (!/\s/.test(s)) return false;                      // must have 2+ words
      if (/^[A-Z0-9\s\/\-&]+$/.test(s)) return false;      // skip ALL CAPS
      if (s.endsWith(":")) return false;                     // skip "Label:" style
      if (/^\[.*\]$/.test(s) || /^\(.*\)$/.test(s)) return false; // skip [placeholder]
      return true;
    });

  if (figmaTexts.length === 0) return findings;

  let missingCount = 0;
  for (const t of figmaTexts) {
    const key = t.toLowerCase().replace(/\s+/g, " ");
    const found =
      liveTexts.has(key) ||
      Array.from(liveTexts).some((lt) => lt.includes(key) || key.includes(lt));
    if (!found) missingCount++;
  }

  // Only report if more than 50% of significant texts are missing — avoids noise
  // from Figma having extra helper text or slightly different wording
  const missingRatio = missingCount / figmaTexts.length;
  if (missingRatio > 0.5 && missingCount >= 3) {
    findings.push({
      category: "presence", severity: "warn",
      description: `${missingCount}/${figmaTexts.length} key text labels from Figma not found in live (${Math.round(missingRatio * 100)}% missing)`,
      evidence: frame.name,
    });
  }
  return findings;
}

// ─── 7-dimension vision analysis ─────────────────────────────────────────────

async function visionAnalysis(liveB64, figmaB64, frameName) {
  const system =
    "You are a senior UI/UX QA engineer doing a pixel-level comparison between a LIVE app screenshot " +
    "and a FIGMA design frame. Score each of 7 dimensions 0-100 (100 = perfect match). " +
    "Be specific, actionable, and reference exact locations on screen. Return JSON only.";

  const user = [
    `Compare LIVE vs FIGMA frame "${frameName}". Analyze all 7 dimensions and return JSON:`,
    `{`,
    `  "frameScore": <0-100 integer — weighted average of all 7>,`,
    `  "summary": "<2 sentence overall assessment>",`,
    `  "dimensions": {`,
    `    "layoutStructure":    { "score": 0-100, "status": "matches|partial|deviates", "notes": "<grid, alignment, panels, column widths>", "issues": ["<specific issue>"] },`,
    `    "typography":         { "score": 0-100, "status": "matches|partial|deviates", "notes": "<font sizes, weights, line-heights, headings vs body>", "issues": [] },`,
    `    "colors":             { "score": 0-100, "status": "matches|partial|deviates", "notes": "<bg, text, accent, border, shadow colors>", "issues": [] },`,
    `    "componentStyling":   { "score": 0-100, "status": "matches|partial|deviates", "notes": "<button styles, input styles, table styles, card borders, radius>", "issues": [] },`,
    `    "iconsAssets":        { "score": 0-100, "status": "matches|partial|deviates", "notes": "<icon presence, size, style, image assets>", "issues": [] },`,
    `    "interactionsStates": { "score": 0-100, "status": "matches|partial|deviates", "notes": "<hover/active/disabled states, loading, empty states, dropdowns>", "issues": [] },`,
    `    "contentAccuracy":    { "score": 0-100, "status": "matches|partial|deviates", "notes": "<static UI copy only — see rules below>", "issues": [] }`,
    `  }`,
    `}`,
    ``,
    `CONTENT ACCURACY rules — this dimension evaluates ONLY static UI copy that is defined by designers/developers:`,
    `  IN SCOPE:  button labels, navigation items, form field labels, placeholder text, empty-state messages,`,
    `             error/validation messages, section headings, tooltip copy, helper text, modal titles.`,
    `  OUT OF SCOPE (ignore completely):  any user-generated content such as record names, row data, dates,`,
    `             IDs, counts, dashboard metric values, table cell content, or anything a user could have`,
    `             typed/created. If the live app shows "Project Alpha" but Figma shows "Project Name",`,
    `             that is NOT a deviation — the design used placeholder data.`,
    ``,
    `Limit issues[] to max 4 per dimension. Use "matches" only when score >= 80. Use "deviates" when score < 50.`,
  ].join("\n");

  const raw = await askVision(system, user, [
    { label: "LIVE",  base64: liveB64 },
    { label: "FIGMA", base64: figmaB64 },
  ], { json: true });

  const j = parseJsonLoose(raw);
  if (!j) {
    return fallbackAnalysis("Could not parse AI response.");
  }

  // Normalise dimensions
  const dims = {};
  for (const key of DIMENSIONS) {
    const d = j.dimensions?.[key] ?? {};
    dims[key] = {
      score:  Math.max(0, Math.min(100, Math.round(d.score ?? 50))),
      status: normStatus(d.status),
      notes:  d.notes  ?? "",
      issues: (d.issues ?? []).slice(0, 4),
    };
  }

  return {
    frameScore: Math.max(0, Math.min(100, Math.round(j.frameScore ?? avgScore(dims)))),
    summary:    j.summary ?? "",
    dimensions: dims,
  };
}

/** Text-only stub when no PNG is available. */
function textOnlyAnalysis(state, frame) {
  const liveSet   = new Set((state.textContent || []).map((s) => s.toLowerCase().trim()));
  const figmaTexts = (frame.textContent || []).map((s) => s.trim());
  const missing   = figmaTexts.filter((t) => !liveSet.has(t.toLowerCase())).slice(0, 4);
  const notes     = missing.length ? `Missing text: ${missing.join(", ")}` : "Text content appears consistent";
  const dims = {};
  for (const key of DIMENSIONS) {
    dims[key] = { score: 50, status: "partial", notes: "No Figma PNG available — visual check skipped", issues: [] };
  }
  dims.contentAccuracy = {
    score: missing.length === 0 ? 80 : Math.max(20, 80 - missing.length * 15),
    status: missing.length === 0 ? "matches" : "partial",
    notes,
    issues: missing.map((t) => `"${t}" present in Figma but missing in live`),
  };
  return {
    frameScore: 50,
    summary: "Visual comparison skipped — Figma PNG not available. Content accuracy checked via text comparison only.",
    dimensions: dims,
  };
}

function fallbackAnalysis(reason) {
  const dims = {};
  for (const key of DIMENSIONS) {
    dims[key] = { score: 0, status: "deviates", notes: reason, issues: [] };
  }
  return { frameScore: 0, summary: reason, dimensions: dims };
}

function normStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v === "matches" || v === "match")   return "matches";
  if (v === "partial")                    return "partial";
  return "deviates";
}

function avgScore(dims) {
  const vals = Object.values(dims).map((d) => d.score ?? 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}
