/**
 * PRD ingestion — three capabilities:
 *
 *   1. extractAcceptanceCriteria   → testable AC checklist (existing)
 *   2. checkAcceptanceCriteria     → keyword-match ACs against captured states (existing)
 *   3. extractScreensAndActions    → expected screen names + user actions from PRD (new)
 *   4. detectCoverageGaps          → compare PRD expectations vs what was captured (new)
 */

import { readFileSync, existsSync } from "fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { askText, parseJsonLoose } from "./ai.mjs";

export async function loadPrd(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const buf = readFileSync(path);
    const { text } = await pdfParse(buf);
    return (text || "").trim();
  } catch (e) {
    console.warn(`   ⚠ PRD parse failed: ${e.message.slice(0, 100)}`);
    return null;
  }
}

// ─── 1. Acceptance criteria extraction ──────────────────────────────────────

export async function extractAcceptanceCriteria(prdText) {
  if (!prdText) return null;
  const trimmed = prdText.slice(0, 14000);

  const system =
    "You extract testable acceptance criteria from product PRDs. " +
    "Return concise, verifiable criteria that can be checked on a live web app. " +
    "Skip implementation notes. Respond JSON only.";

  const user =
    `PRD content:\n---\n${trimmed}\n---\n\n` +
    `Extract up to 15 acceptance criteria. ` +
    `Return JSON: { "criteria": [ { "id": "AC-1", "text": "short", "keywords": ["k1","k2"], "expectedScreen": "short description" } ] }.`;

  const raw = await askText(system, user, { json: true });
  const j = parseJsonLoose(raw);
  return j?.criteria ?? [];
}

// ─── 2. AC keyword check against captured states ────────────────────────────

export async function checkAcceptanceCriteria({ criteria, states, matches }) {
  if (!criteria?.length) return [];

  const results = [];
  for (const ac of criteria) {
    const kw = (ac.keywords || []).map((k) => String(k).toLowerCase());

    const hits = [];
    for (const s of states) {
      const blob = (s.textContent || []).join(" ").toLowerCase();
      const matched = kw.filter((k) => k && blob.includes(k));
      if (matched.length >= Math.max(1, Math.floor(kw.length / 2))) {
        hits.push({ stateId: s.id, url: s.url, matchedKeywords: matched });
      }
    }

    let status = "unknown";
    if (hits.length === 0) status = "fail";
    else if (hits.length >= 1 && kw.length === 0) status = "partial";
    else status = "pass";

    results.push({
      id: ac.id,
      text: ac.text,
      expectedScreen: ac.expectedScreen,
      keywords: kw,
      status,
      evidence: hits.slice(0, 3),
    });
  }
  return results;
}

// ─── 3. Expected screens + actions extraction ────────────────────────────────

/**
 * Extracts:
 *   - screens: distinct screen/page/view names the PRD mentions
 *   - actions: distinct user interactions/flows the PRD describes
 *
 * Used to detect coverage gaps — states the agent should have captured
 * but didn't find during exploration.
 */
export async function extractScreensAndActions(prdText) {
  if (!prdText) return { screens: [], actions: [] };
  const trimmed = prdText.slice(0, 14000);

  const system =
    "You extract expected screens and user interactions from a product PRD. " +
    "Be specific and concise. Return JSON only.";

  const user =
    `PRD content:\n---\n${trimmed}\n---\n\n` +
    `Extract:\n` +
    `1. screens: all distinct screens/pages/views/modals the PRD describes (e.g. "Logbook List", "Create Logbook Modal", "Log History")\n` +
    `2. actions: all distinct user interactions/flows described (e.g. "create a logbook", "pin a logbook", "view log history", "filter by facility")\n\n` +
    `Return JSON: { "screens": ["screen1", "screen2", ...], "actions": ["action1", "action2", ...] }\n` +
    `Limit to 20 screens and 20 actions maximum. Be specific — include sub-screens and modal dialogs.`;

  const raw = await askText(system, user, { json: true });
  const j   = parseJsonLoose(raw);
  return {
    screens: (j?.screens ?? []).slice(0, 20).map(String),
    actions: (j?.actions ?? []).slice(0, 20).map(String),
  };
}

// ─── 4. Coverage gap detection ───────────────────────────────────────────────

/**
 * Compares PRD-expected screens and actions against what the agent captured.
 *
 * Returns:
 *   - missingScreens:  screens PRD mentions but no captured state represents
 *   - untestedActions: actions PRD describes but no live state was triggered by them
 */
export async function detectCoverageGaps({
  expectedScreens, expectedActions, states, matches,
}) {
  const missingScreens  = [];
  const untestedActions = [];

  // Build lookup sets from captured data
  const capturedFrameNames = matches
    .filter((m) => m.frameName)
    .map((m) => m.frameName.toLowerCase());

  const capturedStateText = states
    .flatMap((s) => s.textContent ?? [])
    .map((t) => t.toLowerCase());

  const triggeredDescs = states
    .map((s) => (s.triggerDesc ?? "").toLowerCase())
    .filter(Boolean);

  // Check each expected screen
  for (const screen of (expectedScreens ?? [])) {
    const norm = screen.toLowerCase();
    const found =
      capturedFrameNames.some((n) => tokenOverlap(n, norm) >= 0.5) ||
      capturedStateText.some((t) => t.includes(norm) || norm.split(/\s+/).every((w) => t.includes(w)));
    if (!found) missingScreens.push(screen);
  }

  // Check each expected action
  for (const action of (expectedActions ?? [])) {
    const norm = action.toLowerCase().replace(/^(click|tap|press|open|close|view|go to)\s+/i, "");
    const found = triggeredDescs.some((d) => tokenOverlap(d, norm) >= 0.4);
    if (!found) untestedActions.push(action);
  }

  return { missingScreens, untestedActions };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function tokenOverlap(a, b) {
  const ta = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const tb = new Set(b.split(/\s+/).filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const w of ta) if (tb.has(w)) hits++;
  return hits / Math.min(ta.size, tb.size);
}
