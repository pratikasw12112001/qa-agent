/**
 * PRD ingestion:
 *   - Parse PDF → text
 *   - Ask gpt-4o-mini to extract a testable AC checklist
 *   - For each AC, check if any discovered live state mentions its key terms
 *
 * Cheap (one text call for extraction, one text call per AC check).
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

export async function checkAcceptanceCriteria({ criteria, states, matches }) {
  if (!criteria?.length) return [];

  const results = [];
  for (const ac of criteria) {
    const kw = (ac.keywords || []).map((k) => String(k).toLowerCase());

    // Find state(s) where keywords appear
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

    // For "unknown" cases we could add an LLM re-check; skipping for cost.
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
