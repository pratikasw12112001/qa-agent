/**
 * 3-signal frame ↔ state matcher.
 *
 *   Tier 1 (free): text-jaccard + structure-ratio for all pairs
 *   Tier 2 (vision): top-K candidates per state confirmed with GPT-4o vision
 *
 * For each live state we pick the best Figma frame (or "no match").
 * This avoids 300 vision calls — we only call vision on promising pairs.
 */

import { askVision, parseJsonLoose } from "./ai.mjs";
import { exportFramesPngBatch } from "./figma.mjs";

export async function matchStatesToFrames({
  states, frames, fileKey, figmaToken, thresholds,
}) {
  const W = thresholds.matching;
  const topK = W.topCandidatesForVision ?? 3;

  // Pre-export ALL frame PNGs in ONE batch Figma API call
  const framePngs = new Map();
  try {
    const nodeIds = frames.map((f) => f.id);
    const batchResult = await exportFramesPngBatch(fileKey, nodeIds, figmaToken, 1);
    for (const [id, buf] of Object.entries(batchResult)) {
      framePngs.set(id, buf.toString("base64"));
    }
    console.log(`   Exported ${framePngs.size}/${frames.length} frame PNGs`);
  } catch (e) {
    console.warn(`   ⚠ Batch Figma export failed: ${e.message.slice(0, 80)}`);
  }

  const results = [];

  for (const state of states) {
    // --- Tier 1: text + structure scoring for all frames ---
    const tier1 = frames.map((f) => {
      const textScore   = textSimilarity(f.textContent, state.textContent);
      const structScore = structureSimilarity(f.structure, state.structure);
      const t1 = textScore * (W.textWeight / (W.textWeight + W.structureWeight))
               + structScore * (W.structureWeight / (W.textWeight + W.structureWeight));
      return { frame: f, textScore, structScore, t1 };
    }).sort((a, b) => b.t1 - a.t1);

    // Obvious no-match: best t1 below a low floor → skip vision entirely
    const best = tier1[0];
    if (!best || best.t1 < 0.15) {
      results.push({
        stateId: state.id, frameId: null, frameName: null,
        confidence: best?.t1 ?? 0,
        textScore: best?.textScore ?? 0, structScore: best?.structScore ?? 0,
        visualScore: 0, reasoning: "No Figma frame textually similar",
      });
      continue;
    }

    // --- Tier 2: vision confirmation on top-K candidates ---
    const candidates = tier1.slice(0, topK).filter((c) => framePngs.has(c.frame.id));

    let winner = null;
    let winnerVisual = 0;
    let winnerReasoning = "";

    for (const cand of candidates) {
      const visual = await visionScore(state.screenshot, framePngs.get(cand.frame.id), cand.frame.name);
      if (visual.score > winnerVisual) {
        winnerVisual = visual.score;
        winner = cand;
        winnerReasoning = visual.reasoning;
      }
    }

    if (!winner) {
      results.push({
        stateId: state.id, frameId: null, frameName: null,
        confidence: 0, textScore: 0, structScore: 0, visualScore: 0,
        reasoning: "No vision candidate returned a score",
      });
      continue;
    }

    const confidence =
      winnerVisual * W.visualWeight +
      winner.textScore * W.textWeight +
      winner.structScore * W.structureWeight;

    results.push({
      stateId: state.id,
      frameId: winner.frame.id,
      frameName: winner.frame.name,
      framePage: winner.frame.page,
      framePng: framePngs.get(winner.frame.id),
      confidence,
      textScore: winner.textScore,
      structScore: winner.structScore,
      visualScore: winnerVisual,
      reasoning: winnerReasoning,
      status: confidence >= W.autoAssignScore ? "matched"
            : confidence >= W.reviewScore     ? "review"
            : "unmatched",
    });
  }

  return results;
}

// ─── signal functions ───────────────────────────────────────────────────────

function textSimilarity(figmaTexts, liveTexts) {
  const f = normSet(figmaTexts);
  const l = normSet(liveTexts);
  if (f.size === 0 || l.size === 0) return 0;
  let inter = 0;
  for (const t of f) if (l.has(t)) inter++;
  return inter / Math.min(f.size, l.size);  // asymmetric: does figma appear in live?
}

function normSet(arr) {
  return new Set(
    (arr || [])
      .map((s) => String(s).toLowerCase().replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 2 && s.length < 80)
  );
}

function structureSimilarity(a, b) {
  const keys = ["buttons", "inputs", "images", "links", "tables", "headings"];
  let sum = 0;
  for (const k of keys) {
    const av = a?.[k] ?? 0;
    const bv = b?.[k] ?? 0;
    const max = Math.max(av, bv, 1);
    sum += 1 - Math.abs(av - bv) / max;
  }
  return sum / keys.length;
}

async function visionScore(liveB64, figmaB64, frameName) {
  const system =
    "You compare two UI screenshots: a LIVE app state vs a FIGMA design frame. " +
    "Score 0-1 how likely they represent the same screen/purpose. Reply JSON only.";
  const user =
    `Does the LIVE screenshot represent the same screen as the FIGMA frame "${frameName}"? ` +
    `Consider overall layout, major components, and purpose — ignore minor visual differences. ` +
    `Respond JSON: { "score": 0.0-1.0, "reasoning": "short" }.`;

  const raw = await askVision(system, user, [
    { label: "LIVE",  base64: liveB64 },
    { label: "FIGMA", base64: figmaB64 },
  ], { json: true });

  const j = parseJsonLoose(raw);
  if (!j || typeof j.score !== "number") return { score: 0, reasoning: "parse failed" };
  return { score: Math.max(0, Math.min(1, j.score)), reasoning: j.reasoning ?? "" };
}
