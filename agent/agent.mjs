/**
 * Frontend QA Agent — Main Orchestrator
 *
 * Usage:
 *   node agent.mjs
 *
 * Required env vars:
 *   FIGMA_TOKEN, FIGMA_FILE_URL, LIVE_URL,
 *   LOGIN_EMAIL, LOGIN_PASSWORD, LOGIN_URL
 *
 * Optional:
 *   OPENAI_API_KEY   (Phase 4 PRD analysis)
 *   PRD_PDF_PATH     (local PDF path)
 *   SESSION_PATH     (default: ./sessions/session.json)
 *   OUT_DIR          (default: ./reports)
 *   RUN_ID           (default: timestamp)
 */

// Load .env only when running locally (not in CI)
if (!process.env.CI) {
  try {
    const { config: dotenvConfig } = await import("dotenv");
    dotenvConfig();
  } catch {
    // dotenv not installed — fine in CI
  }
}

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { resolve, join } from "path";

import { detectFrames, exportFramePng } from "./lib/figma.mjs";
import { ensureSession } from "./lib/auth.mjs";
import { captureScreen, captureAnnotated } from "./lib/capture.mjs";
import { matchFramesToRoutes, matchNodesToElements } from "./lib/match.mjs";
import { compareAll, comparePresence } from "./lib/compare.mjs";
import { runFunctionalTests } from "./lib/functional.mjs";
import { runQAChecks } from "./lib/qa.mjs";
import { parsePrd, extractPrdStructure, runPrdCompliance } from "./lib/prd.mjs";
import { generateReport } from "./lib/report.mjs";

// ─── Config ───────────────────────────────────────────────────────────────────

const config = {
  figmaToken:    process.env.FIGMA_TOKEN,
  figmaFileUrl:  process.env.FIGMA_FILE_URL,
  liveUrl:       process.env.LIVE_URL,
  loginUrl:      process.env.LOGIN_URL ?? process.env.LIVE_URL,
  loginEmail:    process.env.LOGIN_EMAIL,
  loginPassword: process.env.LOGIN_PASSWORD,
  sessionPath:   resolve(process.env.SESSION_PATH ?? "./sessions/session.json"),
  outDir:        resolve(process.env.OUT_DIR ?? "./reports"),
  runId:         process.env.RUN_ID ?? Date.now().toString(),
  openaiKey:     process.env.OPENAI_API_KEY ?? null,
  prdPdfPath:    process.env.PRD_PDF_PATH ?? null,
};

function validateConfig() {
  const required = ["figmaToken", "figmaFileUrl", "liveUrl", "loginEmail", "loginPassword"];
  const missing = required.filter((k) => !config[k]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.map((k) => k.replace(/([A-Z])/g, "_$1").toUpperCase()).join(", ")}`);
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  validateConfig();
  mkdirSync(config.outDir, { recursive: true });
  mkdirSync(resolve("./sessions"), { recursive: true });

  console.log(`\n╔══════════════════════════════════════════════`);
  console.log(`║  Frontend QA Agent — Run ${config.runId}`);
  console.log(`║  ${config.liveUrl}`);
  console.log(`╚══════════════════════════════════════════════\n`);

  // ── Step 1: Auth ───────────────────────────────────────────────────────────
  console.log("▶  Auth");
  await ensureSession(config);

  // ── Step 2: Figma Frames ───────────────────────────────────────────────────
  console.log("\n▶  Figma — auto-detecting frames");
  const { fileKey, frames } = await detectFrames(config.figmaFileUrl, config.figmaToken);
  console.log(`   Found ${frames.length} frames`);

  // ── Step 3: Match Frames to Routes ────────────────────────────────────────
  console.log("\n▶  Matching frames to live routes");
  const screenMap = await matchFramesToRoutes(frames, config.liveUrl, config.sessionPath);
  for (const s of screenMap) {
    console.log(`   ${s.name} → ${s.url}`);
  }

  // ── Step 4: PRD ───────────────────────────────────────────────────────────
  let prdStructure = null;
  if (config.prdPdfPath) {
    console.log("\n▶  PRD — parsing");
    const prdText = await parsePrd(config.prdPdfPath);
    if (prdText) {
      prdStructure = await extractPrdStructure(prdText, config.openaiKey);
      console.log(`   ACs: ${prdStructure?.acceptanceCriteria?.length ?? 0}, Flows: ${prdStructure?.userFlows?.length ?? 0}`);
    }
  } else {
    console.log("\n▶  PRD — skipped (no PRD_PDF_PATH set)");
  }

  // ── Step 5: Per-screen testing ────────────────────────────────────────────
  const processedScreens = [];
  const totalScreens = screenMap.length;

  for (let si = 0; si < totalScreens; si++) {
    const screen = screenMap[si];
    console.log(`\n══════════════════════════════════════`);
    console.log(`  Screen ${si + 1}/${totalScreens}: ${screen.name}`);
    console.log(`  ${screen.url}`);
    console.log(`══════════════════════════════════════`);

    // Phase 1: Visual Comparison
    console.log("\n  Phase 1 · Visual Comparison");
    const phase1 = await runPhase1(screen, fileKey, config);
    console.log(`  → ${phase1.findings.length} findings (${phase1.findings.filter((f) => f.severity === "error").length} errors)`);

    // Phase 2: Functional Tests
    console.log("\n  Phase 2 · Functional Tests");
    let phase2 = [];
    try {
      phase2 = await runFunctionalTests(screen, config.sessionPath, config);
      const passed = phase2.filter((t) => t.passed).length;
      console.log(`  → ${passed}/${phase2.length} passed`);
    } catch (e) {
      console.warn(`  ⚠ Functional tests failed: ${e.message.slice(0, 80)}`);
    }

    // Phase 3: QA Completeness
    console.log("\n  Phase 3 · QA Checks");
    let phase3 = null;
    try {
      phase3 = await runQAChecks(screen, config.sessionPath, config);
      const a11yErrors = phase3.accessibility?.filter((i) => i.severity === "error").length ?? 0;
      console.log(`  → Accessibility: ${a11yErrors} errors | Perf LCP: ${phase3.performance?.lcp ?? "?"}ms`);
    } catch (e) {
      console.warn(`  ⚠ QA checks failed: ${e.message.slice(0, 80)}`);
    }

    processedScreens.push({
      name: screen.name,
      url: screen.url,
      captureData: phase1.captureData,
      phase1: { findings: phase1.findings, figmaScreenshot: phase1.figmaScreenshot, annotatedScreenshot: phase1.annotatedScreenshot, figmaWidth: screen.width },
      phase2,
      phase3,
      phase4: null, // filled in after all screens
    });
  }

  // Phase 4: PRD Compliance (cross-screen)
  if (prdStructure) {
    console.log("\n▶  Phase 4 · PRD Compliance");
    try {
      const prd4Result = await runPrdCompliance(processedScreens, prdStructure, config.sessionPath, config);
      processedScreens[0].phase4 = prd4Result;
      const acPass = prd4Result.acceptanceCriteria?.filter((ac) => ac.status === "pass").length ?? 0;
      const acTotal = prd4Result.acceptanceCriteria?.length ?? 0;
      console.log(`  → ACs: ${acPass}/${acTotal} passed`);
    } catch (e) {
      console.warn(`  ⚠ PRD compliance failed: ${e.message.slice(0, 80)}`);
    }
  }

  // ── Step 6: Generate Report ───────────────────────────────────────────────
  console.log("\n▶  Generating report");
  const html = generateReport({
    runId: config.runId,
    screens: processedScreens,
    prd: prdStructure,
    meta: {
      liveUrl: config.liveUrl,
      figmaFileKey: fileKey,
      generatedAt: new Date().toISOString(),
    },
  });

  // Save as report.html (workflow uploads this to gh-pages as {runId}.html)
  const reportPath = join(config.outDir, "report.html");
  writeFileSync(reportPath, html, "utf8");
  console.log(`\n✅  Report saved: ${reportPath}`);

  // Also write to GITHUB_STEP_SUMMARY for quick link in Actions UI
  if (process.env.GITHUB_STEP_SUMMARY) {
    const runId = config.runId;
    const summaryLine = `\n### Report\nhttps://pratikasw12112001.github.io/qa-agent/reports/${runId}.html\n`;
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLine, { flag: "a" });
  }

  const allFindings = processedScreens.flatMap((s) => s.phase1?.findings ?? []);
  const errors = allFindings.filter((f) => f.severity === "error").length;
  const warns  = allFindings.filter((f) => f.severity === "warn").length;
  console.log(`\n  Errors: ${errors} | Warnings: ${warns}`);
  process.exit(0); // always exit 0 so workflow continues to upload step
}

// ─── Phase 1 Runner ───────────────────────────────────────────────────────────

async function runPhase1(screen, fileKey, config) {
  // Export Figma frame
  let figmaScreenshot = "";
  try {
    const buf = await exportFramePng(fileKey, screen.id, config.figmaToken, 1);
    figmaScreenshot = buf.toString("base64");
    console.log(`  Figma frame exported (${screen.width}×${screen.height})`);
  } catch (e) {
    console.warn(`  ⚠ Figma export failed: ${e.message.slice(0, 60)}`);
  }

  // Capture live page
  console.log(`  Capturing live page…`);
  const captureData = await captureScreen(screen.url, config.sessionPath, { width: 1440, height: 900 });
  console.log(`  ${captureData.elements.length} elements extracted`);

  // Match Figma nodes to DOM elements
  const { pairs, unmatchedLive } = matchNodesToElements(
    screen.children ?? [],
    captureData.elements,
    screen.width ?? 1440,
    screen.height ?? 900
  );

  // Run comparisons
  const thresholds = loadThresholds();
  const findings = [];

  const matchedCount = pairs.filter(p => p.liveElement !== null).length;
  const totalNodes   = pairs.length;

  // If nothing matched at all, emit a warning so the score isn't vacuously 100 %
  if (matchedCount === 0 && totalNodes > 0) {
    findings.push({
      category: "match", severity: "warn",
      figmaNodeId: null, figmaNodeName: null, selector: null,
      property: "frame-match",
      figmaValue: `${totalNodes} design nodes`,
      liveValue: "0 DOM elements matched",
      delta: "0 / " + totalNodes,
      description: `None of the ${totalNodes} Figma nodes could be matched to DOM elements — the selected Figma frame may not correspond to this page`,
    });
  }

  for (const { figmaNode, liveElement } of pairs) {
    if (!liveElement) {
      if (figmaNode.text && figmaNode.text.length > 2) {
        findings.push({
          category: "presence", severity: "error",
          figmaNodeId: figmaNode.id, figmaNodeName: figmaNode.name, selector: null,
          property: "element-presence",
          figmaValue: figmaNode.text.slice(0, 60), liveValue: "not found", delta: "missing",
          description: `"${figmaNode.text.slice(0, 60)}" exists in design but not found in live page`,
        });
      }
    } else {
      findings.push(...compareAll(figmaNode, liveElement, thresholds));
    }
  }

  // Presence check for all text nodes
  const textNodes = (screen.children ?? []).filter((n) => n.type === "TEXT" && n.text);
  findings.push(...comparePresence(textNodes, captureData.elements));

  // Annotated screenshot
  let annotatedScreenshot = "";
  const findingsWithSelectors = findings.filter((f) => f.selector);
  if (findingsWithSelectors.length > 0 && figmaScreenshot) {
    try {
      annotatedScreenshot = await captureAnnotated(screen.url, config.sessionPath, findingsWithSelectors);
    } catch (e) {
      console.warn(`  ⚠ Annotation failed: ${e.message.slice(0, 60)}`);
    }
  }

  return { findings, figmaScreenshot, annotatedScreenshot, captureData };
}

function loadThresholds() {
  const path = resolve("../config/thresholds.json");
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  return {
    layout:  { sizeDeltaPx: { warn: 4, error: 12 }, paddingDeltaPx: { warn: 2, error: 8 }, marginDeltaPx: { warn: 4, error: 12 } },
    visual:  { colorDeltaE: { warn: 2, error: 5 }, fontSizeDeltaPx: { warn: 1, error: 3 }, lineHeightDeltaPx: { warn: 2, error: 5 }, borderRadiusDeltaPx: { warn: 2, error: 6 } },
    content: { textSimilarityWarn: 0.85, textSimilarityError: 0.6 },
  };
}

main().catch((e) => { console.error(e); process.exit(1); });
