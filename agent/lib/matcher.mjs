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
  startingFrameId = null,    // explicit override: exact Figma node ID (API format 123:456)
  flowStartingPoints = [],   // auto-detected from prototype flows
}) {
  const W    = thresholds.matching;
  const topK = W.topCandidatesForVision ?? 5;

  if (startingFrameId) {
    console.log(`   Root anchor: explicit startingFrameId ${startingFrameId}`);
  } else if (flowStartingPoints.length) {
    console.log(`   Root anchor: ${flowStartingPoints.length} prototype flow(s) — ${flowStartingPoints.map((f) => `"${f.name}"`).join(", ")}`);
  }

  // ── Phase 1: Text + structure + URL-name scoring for every (state, frame) pair ──
  const tier1Map      = new Map();   // stateId → sorted tier1 array
  const candidateIds  = new Set();   // frame IDs worth exporting

  for (const state of states) {
    // Root bonus: for the root state (no parent), boost the designer-specified
    // starting frame(s) so prototype traversal anchors correctly
    const rootBonus = buildRootBonus(state, startingFrameId, flowStartingPoints);

    const tier1 = frames.map((f) => {
      const textScore   = textSimilarity(f.textContent, state.textContent);
      const structScore = structureSimilarity(f.structure, state.structure);
      const urlBonus    = urlNameBonus(state.url, f.name);
      const rBonus      = rootBonus.get(f.id) ?? 0;
      const t1 = textScore   * (W.textWeight      / (W.textWeight + W.structureWeight))
               + structScore * (W.structureWeight  / (W.textWeight + W.structureWeight))
               + urlBonus + rBonus;
      return { frame: f, textScore, structScore, urlBonus, rootBonus: rBonus, t1 };
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
    const nodeIds = [...candidateIds];
    console.log(`   Exporting PNGs for ${nodeIds.length} candidate frame(s) (of ${frames.length} total)`);

    // Try in batches of 10 to avoid Figma URL-length limits; retry once on failure
    const BATCH_SIZE = 10;
    for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
      const chunk = nodeIds.slice(i, i + BATCH_SIZE);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const batch = await exportFramesPngBatch(fileKey, chunk, figmaToken, 1);
          for (const [id, buf] of Object.entries(batch)) {
            if (buf) framePngs.set(id, Buffer.isBuffer(buf) ? buf.toString("base64") : buf);
          }
          break;  // success
        } catch (e) {
          if (attempt === 2)
            console.warn(`   ⚠ PNG export failed for chunk ${i}-${i+chunk.length}: ${e.message.slice(0,80)}`);
          else {
            console.log(`   Retrying PNG export for chunk ${i}-${i+chunk.length}…`);
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }
    }
    console.log(`   Exported ${framePngs.size}/${nodeIds.length} frame PNG(s)`);
  }

  // ── Phase 3: Vision confirmation + result assembly ───────────────────────────
  // Process states in BFS order so parent matches are available for prototype boost
  const results    = [];
  const matchedMap = new Map();   // stateId → { frameId } — filled as we go

  for (const state of states) {
    const tier1 = tier1Map.get(state.id) ?? [];

    // Apply prototype confidence boost before picking winner
    // If parent state is matched → look up its frame's prototype connections
    // → any frame reachable via the trigger gets a +0.25 score bonus
    const protoBonuses = buildProtoBonuses(state, states, matchedMap, frames);
    const boostedTier1 = tier1.map((c) => {
      const bonus = protoBonuses.get(c.frame.id) ?? 0;
      return { ...c, t1: c.t1 + bonus, protoBonus: bonus };
    }).sort((a, b) => b.t1 - a.t1);

    const best = boostedTier1[0];

    // Hard no-match: nothing above the very low floor (prototype bonus can push past this)
    if (!best || best.t1 < 0.05) {
      results.push({
        stateId: state.id, frameId: null, frameName: null,
        confidence: best?.t1 ?? 0,
        textScore: best?.textScore ?? 0, structScore: best?.structScore ?? 0,
        visualScore: 0, reasoning: "No Figma frame textually/structurally similar",
      });
      continue;
    }

    // Candidates that have PNGs available for vision check (from boosted list)
    const candidates = boostedTier1.slice(0, topK).filter((c) => framePngs.has(c.frame.id));

    // ── No PNGs available → text+structure+proto fallback ───────────────────
    if (candidates.length === 0) {
      const conf = Math.min(best.t1, W.reviewScore - 0.01);
      const result = {
        stateId:     state.id,
        frameId:     best.frame.id,
        frameName:   best.frame.name,
        framePage:   best.frame.page,
        framePng:    null,
        confidence:  conf,
        textScore:   best.textScore,
        structScore: best.structScore,
        visualScore: 0,
        protoBonus:  best.protoBonus ?? 0,
        reasoning:   `Text+structure${best.protoBonus ? "+prototype" : ""} match — no PNG for visual check`,
        status: "review",
      };
      results.push(result);
      matchedMap.set(state.id, result);
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

    if (!winner) {
      winner       = best;
      winnerVisual = 0;
      winnerReason = "Vision returned no score — using text/prototype match";
    }

    const confidence =
      winnerVisual * W.visualWeight +
      winner.textScore * W.textWeight +
      winner.structScore * W.structureWeight;

    const result = {
      stateId:     state.id,
      frameId:     winner.frame.id,
      frameName:   winner.frame.name,
      framePage:   winner.frame.page,
      framePng:    framePngs.get(winner.frame.id) ?? null,
      confidence,
      textScore:   winner.textScore,
      structScore: winner.structScore,
      visualScore: winnerVisual,
      protoBonus:  winner.protoBonus ?? 0,
      reasoning:   winnerReason,
      status: confidence >= W.autoAssignScore ? "matched"
            : confidence >= W.reviewScore     ? "review"
            : "unmatched",
    };
    results.push(result);
    matchedMap.set(state.id, result);
  }

  return results;
}

// ─── root frame anchor bonus ────────────────────────────────────────────────
/**
 * For the root state only (no parent):
 * - Explicit startingFrameId override → +1.0 (essentially forces the match)
 * - Auto-detected flowStartingPoints  → +0.35 each (strong nudge toward entry frames)
 */
function buildRootBonus(state, startingFrameId, flowStartingPoints) {
  const bonuses = new Map();
  if (state.parent !== null) return bonuses;   // only applies to root state

  if (startingFrameId) {
    bonuses.set(startingFrameId, 1.0);
    return bonuses;
  }
  for (const fsp of (flowStartingPoints ?? [])) {
    if (fsp.nodeId) bonuses.set(fsp.nodeId, 0.35);
  }
  return bonuses;
}

// ─── prototype confidence boost ─────────────────────────────────────────────
/**
 * For states that were reached from a parent state:
 * If the parent's matched Figma frame has prototype connections (reactions),
 * find frames reachable via those connections whose element name overlaps
 * with the live trigger description. Boost those frames' scores by +0.25.
 *
 * This is a "confidence booster" — it supplements text+vision, not replaces them.
 */
function buildProtoBonuses(state, states, matchedMap, frames) {
  const bonuses = new Map();
  if (!state.parent) return bonuses;

  const parentResult = matchedMap.get(state.parent);
  if (!parentResult?.frameId) return bonuses;

  const parentFrame = frames.find((f) => f.id === parentResult.frameId);
  if (!parentFrame?.interactions?.length) return bonuses;

  // Normalise the live trigger description for fuzzy comparison
  // e.g. 'click "Create new Logbook"' → 'create new logbook'
  const triggerNorm = (state.triggerDesc || "")
    .toLowerCase()
    .replace(/^click\s+"?/, "")
    .replace(/"$/, "")
    .trim();

  if (!triggerNorm) return bonuses;

  for (const interaction of parentFrame.interactions) {
    // Skip non-click triggers — explorer only fires clicks
    if (interaction.trigger && interaction.trigger !== "ON_CLICK") continue;

    const namNorm   = (interaction.fromNodeName  || "").toLowerCase().trim();
    const labelNorm = (interaction.fromNodeLabel || "").toLowerCase().trim();

    // Match trigger against BOTH layer name AND visible text label.
    // fromNodeLabel (e.g. "Create new Logbook") matches live trigger far better
    // than fromNodeName (e.g. "Button/Primary/Default").
    const matchesName =
      namNorm && (
        triggerNorm.includes(namNorm) ||
        namNorm.includes(triggerNorm) ||
        tokenOverlap(triggerNorm, namNorm) >= 0.5
      );

    const matchesLabel =
      labelNorm && (
        triggerNorm.includes(labelNorm) ||
        labelNorm.includes(triggerNorm) ||
        tokenOverlap(triggerNorm, labelNorm) >= 0.5
      );

    if (matchesName || matchesLabel) {
      bonuses.set(interaction.toFrameId, 0.5);
      const via = matchesLabel ? `label "${interaction.fromNodeLabel}"` : `name "${interaction.fromNodeName}"`;
      console.log(`   → prototype bonus: "${state.triggerDesc}" → frame ${interaction.toFrameId} (+0.5) via ${via}`);
    }
  }
  return bonuses;
}

function tokenOverlap(a, b) {
  const ta = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const tb = new Set(b.split(/\s+/).filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const w of ta) if (tb.has(w)) hits++;
  return hits / Math.min(ta.size, tb.size);
}

// ─── signal functions ───────────────────────────────────────────────────────

function textSimilarity(figmaTexts, liveTexts) {
  // Strip Figma placeholder strings before scoring — they never appear in live
  const f = normSet((figmaTexts || []).filter(t => !isLikelyPlaceholder(t)));
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

/**
 * Returns true if the string looks like Figma placeholder / sample copy
 * that would never appear verbatim in a live application.
 * Filtering these out prevents near-zero text similarity scores on correct matches.
 */
const PLACEHOLDER_EXACT = new Set([
  "placeholder", "subtitle", "description", "label", "title", "name",
  "full name", "first name", "last name", "your name", "enter name",
  "email address", "your email", "enter email", "phone number",
  "company name", "organization", "department", "select option",
  "click here", "type here", "enter text", "add description",
  "untitled", "new item", "item name", "field label", "sample text",
  "edit me", "some text", "text here", "content here",
]);

function isLikelyPlaceholder(s) {
  if (!s) return true;
  const t = String(s).trim();
  // Lorem ipsum
  if (/lorem\s+ipsum/i.test(t)) return true;
  // Bracketed: [Name], {value}
  if (/^\[.*\]$/.test(t) || /^\{.*\}$/.test(t)) return true;
  // Email pattern
  if (/@[a-z]+\.[a-z]{2,}/i.test(t)) return true;
  // Pure numbers / timestamps / IDs: "12345", "#001", "00:00"
  if (/^[\d\s:#\-./,]+$/.test(t) && t.length <= 20) return true;
  // Title Case phrases of 1–3 words under 30 chars — "Full Name", "Company Name"
  // These are almost always design-time labels, not real content
  if (/^[A-Z][a-z]+(\s[A-Z][a-z]+){0,2}$/.test(t) && t.length <= 28) return true;
  // Known placeholder words (exact match or as prefix/suffix)
  const lower = t.toLowerCase();
  if (PLACEHOLDER_EXACT.has(lower)) return true;
  return false;
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

/** Boost score when words in the live URL path appear in the Figma frame name. */
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
