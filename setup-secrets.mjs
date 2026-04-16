/**
 * One-shot script to push GitHub Secrets from .env.
 * Downloads tweetnacl at runtime (no npm install needed).
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import vm from "vm";

// Load .env
const envText = readFileSync(new URL("./.env", import.meta.url), "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const GH_TOKEN = env.GH_TOKEN;
const GH_REPO  = env.GITHUB_REPO;
if (!GH_TOKEN || !GH_REPO) { console.error("Missing GH_TOKEN or GITHUB_REPO"); process.exit(1); }

// Secrets we push to GitHub
const SECRETS = {
  FIGMA_TOKEN:    env.FIGMA_TOKEN,
  LOGIN_EMAIL:    env.LOGIN_EMAIL,
  LOGIN_PASSWORD: env.LOGIN_PASSWORD,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
};

// 1. Load or fetch tweetnacl
const NACL_CACHE = join(tmpdir(), "tweetnacl.raw.js");
let naclSource;
if (existsSync(NACL_CACHE)) {
  naclSource = readFileSync(NACL_CACHE, "utf8");
} else {
  console.log("Downloading tweetnacl…");
  const r = await fetch("https://cdn.jsdelivr.net/npm/tweetnacl@1.0.3/nacl.js");
  if (!r.ok) throw new Error(`fetch tweetnacl failed: ${r.status}`);
  naclSource = await r.text();
  writeFileSync(NACL_CACHE, naclSource);
}

// Run tweetnacl in vm sandbox (UMD — will set module.exports to nacl)
const sandbox = { module: { exports: {} }, exports: {}, require: () => ({}) };
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);
vm.runInContext(naclSource, sandbox);
const nacl = sandbox.module.exports;
if (!nacl || !nacl.box) throw new Error("tweetnacl failed to load");
const SandboxU8 = vm.runInContext("Uint8Array", sandbox);
// Inject randomBytes so nacl.box.keyPair() works
nacl.setPRNG((x, n) => {
  const b = randomBytes(n);
  for (let i = 0; i < n; i++) x[i] = b[i];
});
// Helper to convert any Buffer/U8 to the sandbox's Uint8Array
function toSbx(buf) {
  const u = new SandboxU8(buf.length);
  for (let i = 0; i < buf.length; i++) u[i] = buf[i];
  return u;
}

// 2. Get repo public key
console.log("Fetching repo public key…");
const pkRes = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/secrets/public-key`, {
  headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" },
});
if (!pkRes.ok) throw new Error(`public-key fetch failed: ${pkRes.status} ${await pkRes.text()}`);
const pk = await pkRes.json();

// 3. Implement crypto_box_seal (anonymous box) using tweetnacl primitives
function sealedBox(plaintext, recipientPkB64) {
  const recipient = Buffer.from(recipientPkB64, "base64");
  const ephem = nacl.box.keyPair();  // ephem.publicKey / secretKey are sandbox Uint8Arrays
  // crypto_box_seal nonce = blake2b(ephem_pk || recipient_pk) truncated to 24 bytes
  const nonce_buf = blake2b24(Buffer.concat([Buffer.from(ephem.publicKey), recipient]));
  const msg_buf = Buffer.from(plaintext, "utf8");
  // Must pass sandbox Uint8Array to tweetnacl (instanceof check)
  const box = nacl.box(toSbx(msg_buf), toSbx(nonce_buf), toSbx(recipient), ephem.secretKey);
  // Output: ephem_pk || box
  return Buffer.concat([Buffer.from(ephem.publicKey), Buffer.from(box)]).toString("base64");
}

// tiny blake2b-24 (output 24 bytes) — minimal implementation
function blake2b24(data) {
  return blake2b(data, 24);
}

// --- Blake2b (reference impl, output-length configurable) ---
function blake2b(input, outlen) {
  const BLAKE2B_IV = new Uint32Array([
    0xf3bcc908,0x6a09e667, 0x84caa73b,0xbb67ae85, 0xfe94f82b,0x3c6ef372, 0x5f1d36f1,0xa54ff53a,
    0xade682d1,0x510e527f, 0x2b3e6c1f,0x9b05688c, 0xfb41bd6b,0x1f83d9ab, 0x137e2179,0x5be0cd19
  ]);
  const SIGMA = [
    0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15, 14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3,
    11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4, 7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8,
    9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13, 2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9,
    12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11, 13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10,
    6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5, 10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0,
    0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15, 14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3
  ];

  function ADD64AA(v, a, b) {
    const o0 = v[a] + v[b]; let o1 = v[a+1] + v[b+1];
    if (o0 >= 0x100000000) o1++;
    v[a] = o0; v[a+1] = o1;
  }
  function ADD64AC(v, a, b0, b1) {
    let o0 = v[a] + b0; if (b0 < 0) o0 += 0x100000000;
    let o1 = v[a+1] + b1; if (o0 >= 0x100000000) o1++;
    v[a] = o0; v[a+1] = o1;
  }
  function B2B_GET32(arr, i) {
    return (arr[i]) ^ (arr[i+1] << 8) ^ (arr[i+2] << 16) ^ (arr[i+3] << 24);
  }
  function B2B_G(a,b,c,d,ix,iy) {
    const x0 = m[ix], x1 = m[ix+1];
    const y0 = m[iy], y1 = m[iy+1];
    ADD64AA(v, a, b);
    ADD64AC(v, a, x0, x1);
    let xor0 = v[d] ^ v[a]; let xor1 = v[d+1] ^ v[a+1];
    v[d] = xor1; v[d+1] = xor0;
    ADD64AA(v, c, d);
    xor0 = v[b] ^ v[c]; xor1 = v[b+1] ^ v[c+1];
    v[b] = (xor0 >>> 24) ^ (xor1 << 8); v[b+1] = (xor1 >>> 24) ^ (xor0 << 8);
    ADD64AA(v, a, b);
    ADD64AC(v, a, y0, y1);
    xor0 = v[d] ^ v[a]; xor1 = v[d+1] ^ v[a+1];
    v[d] = (xor0 >>> 16) ^ (xor1 << 16); v[d+1] = (xor1 >>> 16) ^ (xor0 << 16);
    ADD64AA(v, c, d);
    xor0 = v[b] ^ v[c]; xor1 = v[b+1] ^ v[c+1];
    v[b] = (xor1 >>> 31) ^ (xor0 << 1); v[b+1] = (xor0 >>> 31) ^ (xor1 << 1);
  }

  const v = new Uint32Array(32);
  const m = new Uint32Array(32);

  function compress(ctx, last) {
    for (let i = 0; i < 16; i++) { v[i] = ctx.h[i]; v[i+16] = BLAKE2B_IV[i]; }
    v[24] ^= ctx.t; v[25] ^= (ctx.t / 0x100000000) | 0;
    if (last) { v[28] = ~v[28]; v[29] = ~v[29]; }
    for (let i = 0; i < 32; i++) m[i] = B2B_GET32(ctx.b, 4*i);
    for (let i = 0; i < 12; i++) {
      B2B_G(0,8,16,24, SIGMA[i*16+0]*2, SIGMA[i*16+1]*2);
      B2B_G(2,10,18,26, SIGMA[i*16+2]*2, SIGMA[i*16+3]*2);
      B2B_G(4,12,20,28, SIGMA[i*16+4]*2, SIGMA[i*16+5]*2);
      B2B_G(6,14,22,30, SIGMA[i*16+6]*2, SIGMA[i*16+7]*2);
      B2B_G(0,10,20,30, SIGMA[i*16+8]*2, SIGMA[i*16+9]*2);
      B2B_G(2,12,22,24, SIGMA[i*16+10]*2, SIGMA[i*16+11]*2);
      B2B_G(4,14,16,26, SIGMA[i*16+12]*2, SIGMA[i*16+13]*2);
      B2B_G(6,8,18,28, SIGMA[i*16+14]*2, SIGMA[i*16+15]*2);
    }
    for (let i = 0; i < 16; i++) ctx.h[i] ^= v[i] ^ v[i+16];
  }

  const ctx = { b: new Uint8Array(128), h: new Uint32Array(16), t: 0, c: 0, outlen };
  for (let i = 0; i < 16; i++) ctx.h[i] = BLAKE2B_IV[i];
  ctx.h[0] ^= 0x01010000 ^ outlen;

  for (let i = 0; i < input.length; i++) {
    if (ctx.c === 128) { ctx.t += 128; compress(ctx, false); ctx.c = 0; }
    ctx.b[ctx.c++] = input[i];
  }
  ctx.t += ctx.c;
  while (ctx.c < 128) ctx.b[ctx.c++] = 0;
  compress(ctx, true);

  const out = new Uint8Array(outlen);
  for (let i = 0; i < outlen; i++) out[i] = (ctx.h[i >> 2] >> (8 * (i & 3))) & 0xff;
  return Buffer.from(out);
}

// 4. Push each secret
for (const [name, value] of Object.entries(SECRETS)) {
  if (!value) { console.warn(`  skip ${name} (empty)`); continue; }
  const enc = sealedBox(value, pk.key);
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/secrets/${name}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ encrypted_value: enc, key_id: pk.key_id }),
  });
  if (res.ok) console.log(`  ✓ ${name}`);
  else console.error(`  ✗ ${name}: ${res.status} ${await res.text()}`);
}

console.log("\nDone. Secrets pushed to " + GH_REPO);
