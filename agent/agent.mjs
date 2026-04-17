/**
 * Frontend QA Agent — orchestrator.
 *
 *   1. Fetch Figma frames        (figma.mjs)   ← optional, skipped if API unavailable
 *   2. Login to live app         (auth.mjs)
 *   3. Explore UI states         (explorer.mjs) ← sidebar excluded
 *   4. Match states to frames    (matcher.mjs)  ← skipped if no Figma frames
 *   5. Compare matched pairs     (compare.mjs)  ← skipped if no matches
 *   6. Functional tests          (functional.mjs)
 *   7. PRD AC checking           (prd.mjs)
 *   8. Generate HTML report      (report.mjs)
 *
 * The agent always produces report.html — Figma steps are best-effort.
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
  const required = ["liveUrl", "loginEmail", "loginPassword"];
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
  const warnings = [];  // non-fatal issues collected for the report

  // ── 1. Figma frames (best-effort) ─────────────────────────────────────────
  let fileKey = null;
  let frames  = [];
  if (cfg.figmaToken && cfg.figmaFileUrl) {
    console.log("▶  Fetching Figma frames");
    try {
      const result = await fetchFrames(cfg.figmaFileUrl, cfg.figmaToken);
      fileKey = result.fileKey;
      frames  = result.frames;
      console.log(`   → ${frames.length} frame(s)`);
      for (const f of frames) console.log(`     • [${f.page}] "${f.name}" ${Math.round(f.width)}×${Math.round(f.height)}`);
    } catch (e) {
      const msg = e.message || String(e);
      console.warn(`   ⚠ Figma unavailable — skipping design comparison\n   ${msg.slice(0, 200)}`);
      warnings.push({ step: "Figma", message: msg });
    }
  } else {
    console.log("▶  Figma — skipped (no token or URL)");
  }

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
  let matches = [];
  if (frames.length > 0) {
    console.log("\n▶  Matching states to Figma frames");
    matches = await matchStatesToFrames({
      states, frames, fileKey, figmaToken: cfg.figmaToken, thresholds,
    });
    const matched = matches.filter((m) => m.status === "matched").length;
    const review  = matches.filter((m) => m.status === "review").length;
    console.log(`   → ${matched} matched · ${review} review · ${matches.length - matched - review} unmatched`);
  } else {
    console.log("\n▶  Matching — skipped (no Figma frames)");
  }

  // ── 5. Compare each pair ──────────────────────────────────────────────────
  const findings      = [];
  const frameAnalyses = [];   // rich per-frame analysis for the deep-dive section
  if (matches.length > 0) {
    console.log("\n▶  Comparing matched pairs");
    for (const state of states) {
      const m = matches.find((x) => x.stateId === state.id);
      if (!m || !m.frameId) continue;
      const frame = frames.find((f) => f.id === m.frameId);
      const { findings: f, analysis } = await compareStateToFrame({ state, match: m, frame });
      for (const item of f) findings.push({ ...item, stateId: state.id });
      if (analysis) {
        frameAnalyses.push({
          stateId:        state.id,
          frameId:        m.frameId,
          frameName:      m.frameName ?? frame?.name ?? "—",
          frameScore:     analysis.frameScore,
          summary:        analysis.summary,
          analysis,
          liveScreenshot: state.screenshot,
          figmaScreenshot: m.framePng,
          liveUrl:        state.url,
          triggerDesc:    state.triggerDesc,
        });
      }
      console.log(`   ${state.id} → ${frame?.name}: ${f.length} finding(s) · score: ${analysis?.frameScore ?? "?"}/100`);
    }
  } else {
    console.log("\n▶  Comparison — skipped (no matches)");
  }

  // ── 6. Functional tests ───────────────────────────────────────────────────
  console.log("\n▶  Running functional tests");
  let functional = null;
  try {
    functional = await runFunctionalTests({ liveUrl: cfg.liveUrl, sessionPath: cfg.sessionPath, states });
    console.log(`   → console: ${functional.consoleErrors.length} · network: ${functional.networkErrors.length} · broken links: ${functional.brokenLinks.length}`);
  } catch (e) {
    console.warn(`   ⚠ functional tests failed: ${e.message.slice(0, 100)}`);
    warnings.push({ step: "Functional", message: e.message });
  }

  // ── 7. PRD AC checking ────────────────────────────────────────────────────
  let prdAcs = [];
  if (cfg.prdPdfPath && existsSync(cfg.prdPdfPath)) {
    console.log("\n▶  PRD analysis");
    try {
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
    } catch (e) {
      console.warn(`   ⚠ PRD analysis failed: ${e.message.slice(0, 100)}`);
      warnings.push({ step: "PRD", message: e.message });
    }
  } else {
    console.log("\n▶  PRD — skipped (no PDF provided)");
  }

  // ── 8. Report ─────────────────────────────────────────────────────────────
  console.log("\n▶  Generating report");
  const html = generateReport({
    runId: cfg.runId,
    meta: { liveUrl: cfg.liveUrl, figmaFileKey: fileKey },
    frames, states, matches, findings, frameAnalyses, functional, prdAcs,
    warnings,
    aiStats: getAiStats(),
  });
  const reportPath = join(cfg.outDir, "report.html");
  writeFileSync(reportPath, html, "utf8");
  console.log(`   → ${reportPath}`);

  const ai = getAiStats();
  console.log(`\n  AI usage: ${ai.textCalls} text · ${ai.visionCalls} vision · ${ai.cacheHits} cache hits · est. $${ai.cost.toFixed(3)}`);
  if (warnings.length) console.log(`  Warnings: ${warnings.map((w) => w.step).join(", ")}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### QA Report\nhttps://pratikasw12112001.github.io/qa-agent/reports/${cfg.runId}.html\n`,
      { flag: "a" }
    );
  }
}

main().catch((e) => {
  console.error("\n✖  Agent failed:", e);
  // Don't exit 1 here — let the workflow's "Upload report" step check if report.html exists.
  // If we got this far without a report, force-exit so the status is "error".
  process.exit(1);
});
