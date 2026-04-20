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

  // 2. Deep 7-dimension AI analysis (one vision call)
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

    // Match by index (first live ↔ first figma, etc.)
    const pairs = Math.min(liveItems.length, figmaItems.length);
    for (let i = 0; i < pairs; i++) {
      const live  = liveItems[i];
      const figma = figmaItems[i];
      const elLabel = live.label || figma.label || `${label} ${i+1}`;
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

/** Parse hex or rgb(a) color to {r,g,b} 0-255 */
function normalizeColor(c) {
  if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return null;
  // rgb(r,g,b) or rgba(r,g,b,a)
  const rgb = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  // #rrggbb or #rgb
  const hex6 = c.match(/^#([0-9a-f]{6})/i);
  if (hex6) {
    const h = hex6[1];
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  }
  const hex3 = c.match(/^#([0-9a-f]{3})/i);
  if (hex3) {
    const h = hex3[1];
    return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16) };
  }
  return null;
}

/** Returns true if two RGB colors are within `threshold` Euclidean distance */
function colorsClose({ r: r1, g: g1, b: b1 }, { r: r2, g: g2, b: b2 }, threshold) {
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2) <= threshold;
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
    `    "contentAccuracy":    { "score": 0-100, "status": "matches|partial|deviates", "notes": "<labels, placeholders, error messages, copy, data format>", "issues": [] }`,
    `  }`,
    `}`,
    `Limit issues[] to max 4 per dimension. Ignore dynamic data (user names, dates, row counts). `,
    `Use "matches" only when score >= 80. Use "deviates" when score < 50.`,
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
