/**
 * Visual + content comparison between a matched (live state, figma frame) pair.
 *
 * Produces:
 *   - findings[]: flat list of { category, severity, description, evidence }
 *   - analysis:   rich per-frame breakdown (designPatterns, interactions,
 *                 spacing, colors, inaccuracies, frameScore, summary)
 *
 * Combines:
 *   - Missing-text presence check    (free, DOM-based)
 *   - AI deep analysis               (one vision call per matched pair)
 */

import { askVision, parseJsonLoose } from "./ai.mjs";

export async function compareStateToFrame({ state, match, frame }) {
  const findings = [];
  let analysis   = null;

  if (!match.frameId) {
    findings.push({
      category: "match", severity: "warn",
      description: `State "${state.id}" could not be matched to any Figma frame (low similarity across all signals)`,
      evidence: `confidence: ${match.confidence.toFixed(2)}`,
    });
    return { findings, analysis };
  }

  // 1. Missing-text presence (free, deterministic)
  findings.push(...presenceChecks(state, frame));

  // 2. Deep AI analysis — one vision call per pair
  if (match.framePng) {
    analysis = await visionAnalysis(state.screenshot, match.framePng, frame.name);

    // Flatten analysis into findings for backward-compat sections
    if (Array.isArray(analysis.inaccuracies)) {
      for (const inc of analysis.inaccuracies) {
        findings.push({
          category: inc.type ?? "visual",
          severity: normalizeSeverity(inc.severity),
          description: inc.description,
          evidence: frame.name,
        });
      }
    }
    if (Array.isArray(analysis.spacing)) {
      for (const s of analysis.spacing.filter((x) => x.severity !== "ok")) {
        findings.push({
          category: "spacing",
          severity: normalizeSeverity(s.severity),
          description: s.note,
          evidence: s.area,
        });
      }
    }
    if (Array.isArray(analysis.colors)) {
      for (const c of analysis.colors.filter((x) => x.severity !== "ok")) {
        findings.push({
          category: "color",
          severity: normalizeSeverity(c.severity),
          description: `${c.element}: live "${c.liveColor}" vs figma "${c.figmaColor}"`,
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
      if (missingCount <= 8) {     // cap detailed findings
        findings.push({
          category: "presence", severity: "error",
          description: `Text "${t.slice(0, 50)}" exists in Figma but not found in live state`,
          evidence: frame.name,
        });
      }
    }
  }
  if (missingCount > 8) {
    findings.push({
      category: "presence", severity: "warn",
      description: `+${missingCount - 8} more missing text items (truncated)`,
      evidence: frame.name,
    });
  }
  return findings;
}

// ─── deep vision analysis ─────────────────────────────────────────────────────

async function visionAnalysis(liveB64, figmaB64, frameName) {
  const system =
    "You are a senior UI/UX QA engineer. Compare a LIVE app screenshot against a FIGMA design frame " +
    "and produce a detailed structured analysis. Be specific and actionable. " +
    "Score: 0 = completely wrong, 100 = pixel-perfect match. Return JSON only.";

  const user =
    `Deeply analyze LIVE vs FIGMA frame "${frameName}". Return JSON:\n` +
    `{\n` +
    `  "frameScore": <0-100 integer>,\n` +
    `  "summary": "<1-2 sentence overall assessment>",\n` +
    `  "designPatterns": { "status": "matches|deviates|partial", "notes": "<layout, component patterns, visual hierarchy observation>" },\n` +
    `  "interactions": [ { "element": "<button/input/tab/etc>", "status": "present|missing|wrong", "note": "<detail>" } ],\n` +
    `  "spacing": [ { "area": "<location>", "severity": "ok|warn|error", "note": "<padding/margin/gap observation>" } ],\n` +
    `  "colors": [ { "element": "<component>", "liveColor": "<observed>", "figmaColor": "<expected>", "severity": "ok|warn|error" } ],\n` +
    `  "inaccuracies": [ { "type": "text|icon|image|layout|typography", "description": "<specific inaccuracy>", "severity": "error|warn|info" } ]\n` +
    `}\n` +
    `Max 5 items per array. Ignore dynamic content (dates, user-specific data). ` +
    `frameScore reflects overall fidelity to the Figma design.`;

  const raw = await askVision(system, user, [
    { label: "LIVE",  base64: liveB64 },
    { label: "FIGMA", base64: figmaB64 },
  ], { json: true });

  const j = parseJsonLoose(raw);
  if (!j) {
    return {
      frameScore: 0, summary: "Analysis failed — could not parse AI response.",
      designPatterns: { status: "unknown", notes: "" },
      interactions: [], spacing: [], colors: [], inaccuracies: [],
    };
  }
  // Normalise: clamp score, ensure arrays
  return {
    frameScore:     Math.max(0, Math.min(100, Math.round(j.frameScore ?? 0))),
    summary:        j.summary ?? "",
    designPatterns: j.designPatterns ?? { status: "unknown", notes: "" },
    interactions:   (j.interactions  ?? []).slice(0, 5),
    spacing:        (j.spacing       ?? []).slice(0, 5),
    colors:         (j.colors        ?? []).slice(0, 5),
    inaccuracies:   (j.inaccuracies  ?? []).slice(0, 5),
  };
}

function normalizeSeverity(s) {
  const v = String(s || "").toLowerCase();
  if (v === "error" || v === "warn" || v === "info") return v;
  if (v === "warning") return "warn";
  if (v === "critical" || v === "major") return "error";
  return "info";
}
