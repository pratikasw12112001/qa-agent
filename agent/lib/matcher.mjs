/**
 * 3-signal frame ↔ state matcher.
 *
 *   Phase 1: text-jaccard + structure-ratio + URL/name affinity for ALL pairs
 *   Phase 2: export PNGs only for top-K candidate frames (not all 193)
 *   Phase 3: GPT-4o vision confirmation on PNG candidates
 *   Fallback: if PNG export fails, use text+structure winner directly
 *
 * Floor lowered to 0.05 (was 0.15) so near-matches get vision check.
 */

import { askVision, parseJsonLoose } from "./ai.mjs";
import { exportFramesPngBatch } from "./figma.mjs";

export async function matchStatesToFrames({
  states, frames, fileKey, figmaToken, thresholds,
}) {
  const W    = thresholds.matching;
  const topK = W.topCandidatesForVision ?? 5;

  // ── Phase 1: Text + structure + URL-name scoring for every (state, frame) pair ──
  const tier1Map      = new Map();   // stateId → sorted tier1 array
  const candidateIds  = new Set();   // frame IDs worth exporting

  for (const state of states) {
    const tier1 = frames.map((f) => {
      const textScore   = textSimilarity(f.textContent, state.textContent);
      const structScore = structureSimilarity(f.structure, state.structure);
      const urlBonus    = urlNameBonus(state.url, f.name);
      const t1 = textScore   * (W.textWeight      / (W.textWeight + W.structureWeight))
               + structScore * (W.structureWeight  / (W.textWeight + W.structureWeight))
               + urlBonus;
      return { frame: f, textScore, structScore, urlBonus, t1 };
    }).sort((a, b) => b.t1 - a.t1);

    tier1Map.set(state.id, tier1);

    // Collect candidates for batch PNG export
    for (const c of tier1.slice(0, topK)) {
      if (c.t1 >= 0.05) candidateIds.add(c.frame.id);
    }
  }

  // ── Phase 2: Export PNGs only for candidate frames ──────────────────────────
  const framePngs = new Map();
  if (candidateIds.size > 0 && fileKey && figmaToken) {
    try {
      const nodeIds = [...candidateIds];
      console.log(`   Exporting PNGs for ${nodeIds.length} candidate frame(s) (of ${frames.length} total)`);
      const batch = await exportFramesPngBatch(fileKey, nodeIds, figmaToken, 1);
      for (const [id, buf] of Object.entries(batch)) {
        framePngs.set(id, buf.toString("base64"));
      }
      console.log(`   Exported ${framePngs.size} frame PNG(s)`);
    } catch (e) {
      console.warn(`   ⚠ PNG export failed — using text+structure fallback: ${e.message.slice(0, 80)}`);
    }
  }

  // ── Phase 3: Vision confirmation + result assembly ───────────────────────────
  const results = [];

  for (const state of states) {
    const tier1 = tier1Map.get(state.id) ?? [];
    const best  = tier1[0];

    // Hard no-match: nothing above the very low floor
    if (!best || best.t1 < 0.05) {
      results.push({
        stateId: state.id, frameId: null, frameName: null,
        confidence: best?.t1 ?? 0,
        textScore: best?.textScore ?? 0, structScore: best?.structScore ?? 0,
        visualScore: 0, reasoning: "No Figma frame textually/structurally similar",
      });
      continue;
    }

    // Candidates that have PNGs available for vision check
    const candidates = tier1.slice(0, topK).filter((c) => framePngs.has(c.frame.id));

    // ── No PNGs available → text+structure fallback ─────────────────────────
    if (candidates.length === 0) {
      const conf = Math.min(best.t1, W.reviewScore - 0.01);  // cap just below "matched"
      results.push({
        stateId:    state.id,
        frameId:    best.frame.id,
        frameName:  best.frame.name,
        framePage:  best.frame.page,
        framePng:   null,
        confidence: conf,
        textScore:  best.textScore,
        structScore: best.structScore,
        visualScore: 0,
        reasoning: `Text+structure match (score ${conf.toFixed(2)}) — no PNG for visual check`,
        status: "review",
      });
      continue;
    }

    // ── Vision confirmation on top-K candidates ──────────────────────────────
    let winner        = null;
    let winnerVisual  = 0;
    let winnerReason  = "";

    for (const cand of candidates) {
      const v = await visionScore(state.screenshot, framePngs.get(cand.frame.id), cand.frame.name);
      if (v.score > winnerVisual) {
        winnerVisual = v.score;
        winner       = cand;
        winnerReason = v.reasoning;
      }
    }

    // Vision returned nothing useful → fall back to text best
    if (!winner) {
      winner       = best;
      winnerVisual = 0;
      winnerReason = "Vision returned no score — using text match";
    }

    const confidence =
      winnerVisual * W.visualWeight +
      winner.textScore * W.textWeight +
      winner.structScore * W.structureWeight;

    results.push({
      stateId:     state.id,
      frameId:     winner.frame.id,
      frameName:   winner.frame.name,
      framePage:   winner.frame.page,
      framePng:    framePngs.get(winner.frame.id) ?? null,
      confidence,
      textScore:   winner.textScore,
      structScore: winner.structScore,
      visualScore: winnerVisual,
      reasoning:   winnerReason,
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
  return inter / Math.min(f.size, l.size);
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

/** Boost score when frame name words appear in the live URL (e.g. "logbook" in both). */
function urlNameBonus(stateUrl, frameName) {
  const urlWords  = (stateUrl  || "").toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const nameWords = (frameName || "").toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  let hits = 0;
  for (const w of urlWords) if (nameWords.includes(w)) hits++;
  return hits > 0 ? Math.min(0.15, hits * 0.06) : 0;
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
