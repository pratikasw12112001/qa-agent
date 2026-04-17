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

// ─── presence checks ────────────────────────────────────────────────────────

function presenceChecks(state, frame) {
  const findings = [];
  const liveTexts = new Set(
    (state.textContent || []).map((s) => String(s).toLowerCase().replace(/\s+/g, " ").trim())
  );
  const figmaTexts = (frame.textContent || [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 2 && s.length < 80);

  let missingCount = 0;
  for (const t of figmaTexts) {
    const key = t.toLowerCase().replace(/\s+/g, " ");
    const found =
      liveTexts.has(key) ||
      Array.from(liveTexts).some((lt) => lt.includes(key) || key.includes(lt));
    if (!found) {
      missingCount++;
      if (missingCount <= 6) {
        findings.push({
          category: "presence", severity: "error",
          description: `"${t.slice(0, 50)}" present in Figma but missing in live state`,
          evidence: frame.name,
        });
      }
    }
  }
  if (missingCount > 6) {
    findings.push({
      category: "presence", severity: "warn",
      description: `+${missingCount - 6} more missing text items (truncated)`,
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
