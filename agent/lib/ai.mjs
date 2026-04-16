/**
 * OpenAI wrapper — tiered, cached, cheap-first.
 *
 * Tier policy:
 *   - askText()    → gpt-4o-mini   (cheap, for text-only reasoning)
 *   - askVision()  → gpt-4o        (expensive, only when necessary)
 *
 * All responses are cached by SHA of inputs. Same question → no second call.
 */

import OpenAI from "openai";
import { cacheKey, cacheGet, cacheSet } from "./cache.mjs";

const MODEL_TEXT   = "gpt-4o-mini";
const MODEL_VISION = "gpt-4o";

let client = null;
function getClient() {
  if (!client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY missing");
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

let stats = { textCalls: 0, visionCalls: 0, cacheHits: 0, cost: 0 };
export function getAiStats() { return { ...stats }; }

/** Text-only reasoning. Cheap. Use for summarisation, ranking, JSON extraction. */
export async function askText(system, user, { json = false } = {}) {
  const key = cacheKey("text", MODEL_TEXT, system, user, json ? "json" : "plain");
  const hit = cacheGet(key);
  if (hit) { stats.cacheHits++; return hit; }

  const res = await getClient().chat.completions.create({
    model: MODEL_TEXT,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
    ...(json ? { response_format: { type: "json_object" } } : {}),
    temperature: 0,
  });

  stats.textCalls++;
  stats.cost += estimateCost(MODEL_TEXT, res.usage);

  const out = res.choices?.[0]?.message?.content?.trim() ?? "";
  cacheSet(key, out);
  return out;
}

/**
 * Vision reasoning. Expensive — use sparingly.
 * images: [{ label, base64 }]
 * Returns parsed JSON (if json=true) or string.
 */
export async function askVision(system, user, images, { json = false } = {}) {
  const imgHashes = images.map((i) => cacheKey(i.base64));
  const key = cacheKey("vision", MODEL_VISION, system, user, json ? "json" : "plain", ...imgHashes);
  const hit = cacheGet(key);
  if (hit) { stats.cacheHits++; return hit; }

  const imageContent = images.map((img) => ({
    type: "image_url",
    image_url: { url: `data:image/png;base64,${img.base64}`, detail: "low" },
  }));

  const res = await getClient().chat.completions.create({
    model: MODEL_VISION,
    messages: [
      { role: "system", content: system },
      { role: "user", content: [{ type: "text", text: user }, ...imageContent] },
    ],
    ...(json ? { response_format: { type: "json_object" } } : {}),
    temperature: 0,
    max_tokens: 800,
  });

  stats.visionCalls++;
  stats.cost += estimateCost(MODEL_VISION, res.usage);

  const out = res.choices?.[0]?.message?.content?.trim() ?? "";
  cacheSet(key, out);
  return out;
}

/** Rough cost estimation for telemetry. */
function estimateCost(model, usage) {
  if (!usage) return 0;
  const rates = {
    "gpt-4o-mini": { in: 0.15 / 1e6, out: 0.60 / 1e6 },
    "gpt-4o":      { in: 2.50 / 1e6, out: 10.0 / 1e6 },
  };
  const r = rates[model] ?? { in: 0, out: 0 };
  return (usage.prompt_tokens ?? 0) * r.in + (usage.completion_tokens ?? 0) * r.out;
}

/** Safely parse a JSON response that may have surrounding prose. */
export function parseJsonLoose(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}
