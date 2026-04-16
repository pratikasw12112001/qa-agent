/**
 * Persistent AI response cache (disk-backed JSON).
 * Keyed by SHA256 of (model + prompt + input-hash).
 * Avoids duplicate OpenAI calls across a run — and across retries.
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

const CACHE_PATH = resolve("./cache/ai-cache.json");
let cache = null;

function load() {
  if (cache) return cache;
  if (existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
      return cache;
    } catch {
      cache = {};
      return cache;
    }
  }
  cache = {};
  return cache;
}

function persist() {
  if (!cache) return;
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

export function cacheKey(...parts) {
  const h = createHash("sha256");
  for (const p of parts) {
    if (Buffer.isBuffer(p)) h.update(p);
    else h.update(String(p ?? ""));
  }
  return h.digest("hex");
}

export function cacheGet(key) {
  return load()[key] ?? null;
}

export function cacheSet(key, value) {
  load()[key] = value;
  persist();
}

export function cacheStats() {
  const c = load();
  return { entries: Object.keys(c).length };
}
