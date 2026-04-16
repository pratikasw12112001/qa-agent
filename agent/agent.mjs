/**
 * Frontend QA Agent — orchestrator.
 *
 *   1. Fetch Figma frames        (figma.mjs)
 *   2. Login to live app         (auth.mjs)   ← credentials from env, never user input
 *   3. Explore UI states         (explorer.mjs) ← sidebar excluded
 *   4. Match states to frames    (matcher.mjs)  ← 3-signal, vision-confirmed
 *   5. Compare matched pairs     (compare.mjs)  ← vision diff + presence
 *   6. Functional tests          (functional.mjs)
 *   7. PRD AC checking           (prd.mjs)
 *   8. Generate HTML report      (report.mjs)
 */

if (!process.env.CI) {
  try {
    const { config } = await import("dotenv");
    config();
  } catch {}
}

import { resolve, join } from "path";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";

import { fetchFrames }             from "./lib/figma.mjs";
import { loginAndCaptureSession }  from "./lib/auth.mjs";
import { exploreStates }           from "./lib/explorer.mjs";
import { matchStatesToFrames }     from "./lib/matcher.mjs";
import { compareStateToFrame }     from "./lib/compare.mjs";
import { runFunctionalTests }      from "./lib/functional.mjs";
import { loadPrd, extractAcceptanceCriteria, checkAcceptanceCriteria } from "./lib/prd.mjs";
import { generateReport }          from "./lib/report.mjs";
import { getAiStats }              from "./lib/ai.mjs";

const cfg = {
  figmaToken:    process.env.FIGMA_TOKEN,
  figmaFileUrl:  process.env.FIGMA_FILE_URL,
  liveUrl:       process.env.LIVE_URL,
  loginEmail:    process.env.LOGIN_EMAIL,
  loginPassword: process.env.LOGIN_PASSWORD,
  prdPdfPath:    process.env.PRD_PDF_PATH || null,
  sessionPath:   resolve(process.env.SESSION_PATH ?? "./sessions/session.json"),
  outDir:        resolve(process.env.OUT_DIR ?? "./reports"),
  runId:         process.env.RUN_ID ?? Date.now().toString(),
};

function validate() {
  const required = ["figmaToken", "figmaFileUrl", "liveUrl", "loginEmail", "loginPassword"];
  const missing = required.filter((k) => !cfg[k]);
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function loadThresholds() {
  const path = resolve("../config/thresholds.json");
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  return {
    matching: { visualWeight: 0.6, textWeight: 0.25, structureWeight: 0.15, autoAssignScore: 0.7, reviewScore: 0.5, topCandidatesForVision: 3 },
    comparison: {},
    exploration: { maxStates: 30, maxDepth: 3, waitAfterClickMs: 1200 },
  };
}

async function main() {
  validate();
  mkdirSync(cfg.outDir, { recursive: true });
  mkdirSync(resolve("./sessions"), { recursive: true });

  console.log(`\n╔═══════════════════════════════════════════════`);
  console.log(`║  QA Agent — Run ${cfg.runId}`);
  console.log(`║  ${cfg.liveUrl}`);
  console.log(`╚═══════════════════════════════════════════════\n`);

  const thresholds = loadThresholds();

  // ── 1. Figma frames ───────────────────────────────────────────────────────
  console.log("▶  Fetching Figma frames");
  const { fileKey, frames } = await fetchFrames(cfg.figmaFileUrl, cfg.figmaToken);
  console.log(`   → ${frames.length} frame(s)`);
  for (const f of frames) console.log(`     • [${f.page}] "${f.name}" ${Math.round(f.width)}×${Math.round(f.height)}`);

  // ── 2. Login ──────────────────────────────────────────────────────────────
  console.log("\n▶  Logging into live app");
  await loginAndCaptureSession({ liveUrl: cfg.liveUrl, sessionPath: cfg.sessionPath });

  // ── 3. Explore states ─────────────────────────────────────────────────────
  console.log("\n▶  Exploring UI states (sidebar excluded)");
  const states = await exploreStates({
    liveUrl: cfg.liveUrl, sessionPath: cfg.sessionPath,
    ...thresholds.exploration,
  });

  // ── 4. Match states to frames ─────────────────────────────────────────────
  console.log("\n▶  Matching states to Figma frames");
  const matches = await matchStatesToFrames({
    states, frames, fileKey, figmaToken: cfg.figmaToken, thresholds,
  });
  const matched = matches.filter((m) => m.status === "matched").length;
  const review  = matches.filter((m) => m.status === "review").length;
  console.log(`   → ${matched} matched · ${review} review · ${matches.length - matched - review} unmatched`);

  // ── 5. Compare each pair ──────────────────────────────────────────────────
  console.log("\n▶  Comparing matched pairs");
  const findings = [];
  for (const state of states) {
    const m = matches.find((x) => x.stateId === state.id);
    if (!m || !m.frameId) continue;
    const frame = frames.find((f) => f.id === m.frameId);
    const f = await compareStateToFrame({ state, match: m, frame });
    for (const item of f) findings.push({ ...item, stateId: state.id });
    console.log(`   ${state.id} → ${frame?.name}: ${f.length} finding(s)`);
  }

  // ── 6. Functional tests ───────────────────────────────────────────────────
  console.log("\n▶  Running functional tests");
  let functional = null;
  try {
    functional = await runFunctionalTests({ liveUrl: cfg.liveUrl, sessionPath: cfg.sessionPath, states });
    console.log(`   → console: ${functional.consoleErrors.length} · network: ${functional.networkErrors.length} · broken links: ${functional.brokenLinks.length}`);
  } catch (e) {
    console.warn(`   ⚠ functional tests failed: ${e.message.slice(0, 100)}`);
  }

  // ── 7. PRD AC checking ────────────────────────────────────────────────────
  let prdAcs = [];
  if (cfg.prdPdfPath) {
    console.log("\n▶  PRD analysis");
    const prdText = await loadPrd(cfg.prdPdfPath);
    if (prdText) {
      const criteria = await extractAcceptanceCriteria(prdText);
      console.log(`   → ${criteria?.length ?? 0} acceptance criteria extracted`);
      prdAcs = await checkAcceptanceCriteria({ criteria, states, matches });
      const pass = prdAcs.filter((a) => a.status === "pass").length;
      console.log(`   → ${pass}/${prdAcs.length} passed`);
    } else {
      console.log("   → PDF could not be parsed, skipping");
    }
  } else {
    console.log("\n▶  PRD — skipped (no PRD_PDF_PATH)");
  }

  // ── 8. Report ─────────────────────────────────────────────────────────────
  console.log("\n▶  Generating report");
  const html = generateReport({
    runId: cfg.runId,
    meta: { liveUrl: cfg.liveUrl, figmaFileKey: fileKey },
    frames, states, matches, findings, functional, prdAcs,
    aiStats: getAiStats(),
  });
  const reportPath = join(cfg.outDir, "report.html");
  writeFileSync(reportPath, html, "utf8");
  console.log(`   → ${reportPath}`);

  const ai = getAiStats();
  console.log(`\n  AI usage: ${ai.textCalls} text · ${ai.visionCalls} vision · ${ai.cacheHits} cache hits · est. $${ai.cost.toFixed(3)}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### QA Report\nhttps://pratikasw12112001.github.io/qa-agent/reports/${cfg.runId}.html\n`,
      { flag: "a" }
    );
  }
}

main().catch((e) => { console.error("\n✖  Agent failed:", e); process.exit(1); });
