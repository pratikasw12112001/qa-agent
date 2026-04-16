/**
 * Visual + content comparison between a matched (live state, figma frame) pair.
 *
 * Produces a list of findings, each:
 *   { category, severity, description, evidence }
 *
 * Combines:
 *   - Missing-text presence check  (free, DOM-based)
 *   - AI-powered style/layout diff (one cheap vision call per pair)
 */

import { askVision, parseJsonLoose } from "./ai.mjs";

export async function compareStateToFrame({ state, match, frame }) {
  const findings = [];

  if (!match.frameId) {
    findings.push({
      category: "match", severity: "warn",
      description: `State "${state.id}" could not be matched to any Figma frame (low similarity across all signals)`,
      evidence: `confidence: ${match.confidence.toFixed(2)}`,
    });
    return findings;
  }

  // 1. Missing-text presence (free, deterministic)
  findings.push(...presenceChecks(state, frame));

  // 2. AI visual diff — one vision call per pair (top-level differences only)
  if (match.framePng) {
    const diffs = await visionDiff(state.screenshot, match.framePng, frame.name);
    for (const d of diffs) findings.push({
      category: d.category ?? "visual",
      severity: normalizeSeverity(d.severity),
      description: d.description,
      evidence: d.evidence ?? "",
    });
  }

  return findings;
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

// ─── vision diff ────────────────────────────────────────────────────────────

async function visionDiff(liveB64, figmaB64, frameName) {
  const system =
    "You are a UI QA reviewer. Given a LIVE app screenshot and a FIGMA design, " +
    "list the top 0-6 IMPORTANT visual differences (layout, color, typography, spacing, missing elements). " +
    "Skip minor pixel differences. Ignore dynamic content like dates, numbers, user names. " +
    "Return JSON only.";

  const user =
    `Compare LIVE vs FIGMA (frame "${frameName}"). ` +
    `Return JSON: { "differences": [ { "category": "layout|color|typography|spacing|missing|copy", "severity": "error|warn|info", "description": "short", "evidence": "where on screen" } ] }. ` +
    `Limit to the 6 most impactful differences. If nearly identical, return differences: [].`;

  const raw = await askVision(system, user, [
    { label: "LIVE",  base64: liveB64 },
    { label: "FIGMA", base64: figmaB64 },
  ], { json: true });

  const j = parseJsonLoose(raw);
  if (!j || !Array.isArray(j.differences)) return [];
  return j.differences.slice(0, 8);
}

function normalizeSeverity(s) {
  const v = String(s || "").toLowerCase();
  if (v === "error" || v === "warn" || v === "info") return v;
  if (v === "warning") return "warn";
  if (v === "critical" || v === "major") return "error";
  return "info";
}
