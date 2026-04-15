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
 *   PRD_BLOB_URL     (Vercel Blob URL for PDF)
 *   SESSION_PATH     (default: ./sessions/session.json)
 *   OUT_DIR          (default: ./reports)
 *   RUN_ID           (default: timestamp)
 *   BLOB_TOKEN       (Vercel Blob write token, for CI)
 */

import "dotenv/config";
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
  prdBlobUrl:    process.env.PRD_BLOB_URL ?? null,
  blobToken:     process.env.BLOB_TOKEN ?? null,
};

function validateConfig() {
  const required = ["figmaToken", "figmaFileUrl", "liveUrl", "loginEmail", "loginPassword"];
  const missing = required.filter((k) => !config[k]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.map((k) => k.toUpperCase().replace(/([A-Z])/g, "_$1").toUpperCase()).join(", ")}`);
    process.exit(1);
  }
}

// ─── Progress (for web UI polling) ───────────────────────────────────────────

async function updateProgress(data) {
  if (!config.blobToken) return;
  try {
    const { put } = await import("@vercel/blob");
    await put(`progress/${config.runId}.json`, JSON.stringify(data), {
      access: "public", token: config.blobToken, addRandomSuffix: false,
    });
  } catch (e) {
    // Non-fatal — local runs don't need blob
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

  await updateProgress({ runId: config.runId, status: "starting", phase: 0 });

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
  if (config.prdPdfPath || config.prdBlobUrl) {
    console.log("\n▶  PRD — parsing");
    let pdfSource = config.prdPdfPath;
    if (config.prdBlobUrl) {
      const res = await fetch(config.prdBlobUrl);
      pdfSource = Buffer.from(await res.arrayBuffer());
    }
    const prdText = await parsePrd(pdfSource);
    if (prdText) {
      prdStructure = await extractPrdStructure(prdText, config.openaiKey);
      console.log(`   ACs: ${prdStructure?.acceptanceCriteria?.length ?? 0}, Flows: ${prdStructure?.userFlows?.length ?? 0}`);
    }
  } else {
    console.log("\n▶  PRD — skipped (no PRD_PDF_PATH or PRD_BLOB_URL)");
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

    await updateProgress({ runId: config.runId, status: "running", currentScreen: si + 1, totalScreens, screenName: screen.name });

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
      // Attach PRD results to first screen (they're cross-screen)
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

  const reportPath = join(config.outDir, `qa-${config.runId}.html`);
  writeFileSync(reportPath, html, "utf8");
  console.log(`\n✅  Report saved: ${reportPath}`);

  // Upload to Vercel Blob (CI)
  if (config.blobToken) {
    try {
      const { put } = await import("@vercel/blob");
      const blob = await put(`reports/${config.runId}.html`, html, {
        access: "public", token: config.blobToken, contentType: "text/html", addRandomSuffix: false,
      });
      console.log(`🌐  Blob URL: ${blob.url}`);
      await updateProgress({ runId: config.runId, status: "done", reportUrl: blob.url });
      if (process.env.GITHUB_OUTPUT) {
        const out = `report_url=${blob.url}\nrun_id=${config.runId}\n`;
        writeFileSync(process.env.GITHUB_OUTPUT, out, { flag: "a" });
      }
    } catch (e) {
      console.warn("  ⚠ Blob upload failed:", e.message.slice(0, 80));
    }
  }

  // Summary
  const allFindings = processedScreens.flatMap((s) => s.phase1?.findings ?? []);
  const errors = allFindings.filter((f) => f.severity === "error").length;
  const warns  = allFindings.filter((f) => f.severity === "warn").length;
  console.log(`\n  Errors: ${errors} | Warnings: ${warns}`);
  process.exit(errors > 0 ? 1 : 0);
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

  for (const { figmaNode, liveElement } of pairs) {
    if (!liveElement) {
      // Figma node not found in live
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
  // Defaults
  return {
    layout:  { sizeDeltaPx: { warn: 4, error: 12 }, paddingDeltaPx: { warn: 2, error: 8 }, marginDeltaPx: { warn: 4, error: 12 } },
    visual:  { colorDeltaE: { warn: 2, error: 5 }, fontSizeDeltaPx: { warn: 1, error: 3 }, lineHeightDeltaPx: { warn: 2, error: 5 }, borderRadiusDeltaPx: { warn: 2, error: 6 } },
    content: { textSimilarityWarn: 0.85, textSimilarityError: 0.6 },
  };
}

main().catch((e) => { console.error(e); process.exit(1); });
