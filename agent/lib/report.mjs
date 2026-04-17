/**
 * HTML report generator — self-contained, single-file, shareable.
 *
 * Sections (audience-agnostic but labelled):
 *   1. Header + Quality Score
 *   2. Executive Summary (for PMs)
 *   3. State Graph (for designers/QA)
 *   4. Per-State Findings (for QA/designers)
 *   5. Functional Results (for QA)
 *   6. Accessibility (for QA/designers)
 *   7. PRD AC Checklist (for PMs, if PRD provided)
 *   8. Raw JSON (collapsed, for debugging)
 */

export function generateReport({
  runId, meta, frames, states, matches, findings, frameAnalyses = [],
  functional, prdAcs, coverageGaps = { missingScreens: [], untestedActions: [] },
  aiStats, warnings = [],
}) {
  const score = computeScore(findings, matches, functional);
  const now = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Report · ${escapeHtml(runId)}</title>
<style>
  :root {
    --bg: #0b0f1a; --panel: #111827; --panel-2: #1a2235; --border: #1e2640;
    --text: #e2e8f0; --muted: #94a3b8; --dim: #64748b;
    --blue: #3b82f6; --green: #22c55e; --yellow: #eab308; --red: #ef4444; --orange: #f97316;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         background: var(--bg); color: var(--text); line-height: 1.5; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 24px; }
  .hero { background: linear-gradient(135deg,#1e2a5a,#111827); border: 1px solid var(--border);
          border-radius: 14px; padding: 28px; margin-bottom: 24px; }
  .hero h1 { margin: 0 0 6px 0; font-size: 26px; }
  .hero .sub { color: var(--muted); font-size: 14px; margin-bottom: 18px; }
  .score { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
  .score .big { font-size: 64px; font-weight: 800; line-height: 1; }
  .score .label { font-size: 12px; text-transform: uppercase; color: var(--muted); letter-spacing: .08em; }
  .chips { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
  .chip { padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .chip.err  { background: rgba(239,68,68,.15); color: #fca5a5; }
  .chip.warn { background: rgba(234,179,8,.15); color: #fde68a; }
  .chip.info { background: rgba(59,130,246,.15); color: #93c5fd; }
  .chip.ok   { background: rgba(34,197,94,.15); color: #86efac; }

  section { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 22px; margin-bottom: 18px; }
  section h2 { margin: 0 0 14px 0; font-size: 18px; display: flex; align-items: center; gap: 10px; }
  section h2 .aud { font-size: 11px; background: var(--panel-2); padding: 3px 8px; border-radius: 6px; color: var(--muted); font-weight: 500; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .card { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
  .card .k { color: var(--muted); font-size: 12px; }
  .card .v { font-size: 22px; font-weight: 700; }

  .state { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 14px; overflow: hidden; background: var(--panel-2); }
  .state-header { padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px;
                  cursor: pointer; user-select: none; }
  .state-header:hover { background: #1f2a45; }
  .state-title { font-weight: 600; }
  .state-sub   { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .state-body  { display: none; padding: 14px 16px; border-top: 1px solid var(--border); }
  .state.open .state-body { display: block; }
  .state-images { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .state-images figure { margin: 0; }
  .state-images figcaption { font-size: 11px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .06em; }
  .state-images img { width: 100%; border: 1px solid var(--border); border-radius: 8px; background: #000; }

  .finding { background: #0e1626; border: 1px solid var(--border); border-left: 3px solid var(--dim); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }
  .finding.error { border-left-color: var(--red); }
  .finding.warn  { border-left-color: var(--yellow); }
  .finding.info  { border-left-color: var(--blue); }
  .finding .head { display: flex; gap: 8px; align-items: center; font-size: 12px; margin-bottom: 4px; color: var(--muted); }
  .finding .desc { font-size: 13px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }

  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .pill.matched   { background: rgba(34,197,94,.15); color: #86efac; }
  .pill.review    { background: rgba(234,179,8,.15); color: #fde68a; }
  .pill.unmatched { background: rgba(239,68,68,.15); color: #fca5a5; }
  .pill.pass { background: rgba(34,197,94,.15); color: #86efac; }
  .pill.fail { background: rgba(239,68,68,.15); color: #fca5a5; }
  .pill.partial { background: rgba(234,179,8,.15); color: #fde68a; }
  .pill.unknown { background: rgba(148,163,184,.15); color: #cbd5e1; }

  details { margin-top: 10px; }
  details summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  pre { background: #0e1626; border: 1px solid var(--border); border-radius: 6px; padding: 10px; overflow-x: auto; font-size: 11px; }
  footer { color: var(--dim); font-size: 12px; text-align: center; padding: 14px; }

  /* Frame deep-analysis styles */
  .fa-frame { background: var(--panel-2); border: 1px solid var(--border); border-radius: 14px; margin-bottom: 24px; overflow: hidden; }
  .fa-header { background: var(--panel); padding: 18px 22px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); }
  .fa-header h3 { margin: 0; font-size: 16px; }
  .fa-header .sub { color: var(--muted); font-size: 12px; margin-top: 3px; }
  .score-ring { width: 72px; height: 72px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 800; font-size: 22px; flex-shrink: 0; border: 4px solid; }
  .score-ring .ring-label { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: .06em; margin-top: 1px; }
  .fa-screenshots { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 22px; border-bottom: 1px solid var(--border); }
  .fa-cat { padding: 14px 22px; border-bottom: 1px solid var(--border); }
  .fa-cat:last-child { border-bottom: none; }
  .fa-cat-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
  .fa-cat-title .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; }
  .fa-row { display: grid; gap: 8px; grid-template-columns: 1fr 2fr; font-size: 13px; padding: 6px 0; border-bottom: 1px solid #1a2235; }
  .fa-row:last-child { border-bottom: none; }
  .fa-key { color: var(--muted); font-size: 12px; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .status-matches { background: rgba(34,197,94,.15); color: #86efac; }
  .status-partial  { background: rgba(234,179,8,.15); color: #fde68a; }
  .status-deviates { background: rgba(239,68,68,.15); color: #fca5a5; }
  .status-present  { background: rgba(34,197,94,.15); color: #86efac; }
  .status-missing  { background: rgba(239,68,68,.15); color: #fca5a5; }
  .status-wrong    { background: rgba(234,179,8,.15); color: #fde68a; }
  .sev-ok    { color: #86efac; }
  .sev-warn  { color: #fde68a; }
  .sev-error { color: #fca5a5; }

  /* Combined assessment */
  .combined { display: grid; grid-template-columns: auto 1fr; gap: 28px; align-items: start; }
  .combined-score { text-align: center; }
  .combined-score .big-score { font-size: 72px; font-weight: 900; line-height: 1; }
  .combined-score .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
  .insight-list { list-style: none; padding: 0; margin: 0; }
  .insight-list li { padding: 6px 0; font-size: 14px; border-bottom: 1px solid var(--border); }
  .insight-list li:last-child { border-bottom: none; }
  .insight-list li::before { content: "→ "; color: var(--blue); font-weight: 700; }

  /* 7-dimension card grid */
  .fa-dim-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .fa-dim-card { background: #0e1626; border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
</style>
</head>
<body>
<div class="wrap">

  ${warnings.length ? `
  <div style="background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.3);border-radius:10px;padding:14px 18px;margin-bottom:18px">
    <div style="font-weight:700;color:#fde68a;margin-bottom:6px">⚠ Partial run — some steps were skipped</div>
    ${warnings.map(w => `<div style="font-size:13px;color:#fcd34d;margin-bottom:4px"><strong>${escapeHtml(w.step)}:</strong> ${escapeHtml(w.message.slice(0, 200))}</div>`).join("")}
  </div>` : ""}

  <div class="hero">
    <h1>Frontend QA Report</h1>
    <div class="sub">Run <code>${escapeHtml(runId)}</code> · ${escapeHtml(meta.liveUrl)} · ${escapeHtml(now)}</div>
    <div class="score">
      <div>
        <div class="label">Quality score</div>
        <div class="big" style="color:${scoreColor(score.value)}">${score.value}${score.noData ? "" : " / 100"}</div>
      </div>
      <div>
        <div class="chips">
          <span class="chip err">${score.errors} errors</span>
          <span class="chip warn">${score.warns} warnings</span>
          <span class="chip info">${matches.filter(m => m.status === "matched").length} matched</span>
          <span class="chip info">${matches.filter(m => m.status === "review").length} review</span>
          <span class="chip info">${matches.filter(m => m.status === "unmatched").length} unmatched</span>
        </div>
      </div>
    </div>
  </div>

  <section>
    <h2>Executive Summary <span class="aud">PM / Lead</span></h2>
    <div class="grid-2">
      <div class="card"><div class="k">Figma frames</div><div class="v">${frames.length}</div></div>
      <div class="card"><div class="k">Live states discovered</div><div class="v">${states.length}</div></div>
      <div class="card"><div class="k">Matched (high confidence)</div><div class="v">${matches.filter(m => m.status === "matched").length}</div></div>
      <div class="card"><div class="k">Issues found</div><div class="v">${score.errors + score.warns}</div></div>
    </div>
    ${renderTopIssues(findings)}
  </section>

  <section>
    <h2>State Graph <span class="aud">QA / Designer</span></h2>
    ${renderStateGraph(states, matches)}
  </section>

  <section>
    <h2>Visual &amp; Content Findings <span class="aud">Designer / QA</span></h2>
    ${renderStateFindings(states, matches, findings, frames)}
  </section>

  ${frameAnalyses.length ? `
  <section>
    <h2>Frame-by-Frame Deep Analysis <span class="aud">Designer / QA</span></h2>
    ${renderFrameAnalyses(frameAnalyses)}
  </section>

  <section>
    <h2>Combined Assessment <span class="aud">PM / Lead</span></h2>
    ${renderCombinedAssessment(frameAnalyses)}
  </section>` : ""}

  <section>
    <h2>Functional Tests <span class="aud">QA</span></h2>
    ${renderFunctional(functional)}
  </section>

  <section>
    <h2>Accessibility <span class="aud">QA / Designer</span></h2>
    ${renderA11y(functional)}
  </section>

  ${prdAcs && prdAcs.length ? `
  <section>
    <h2>PRD · Acceptance Criteria <span class="aud">PM</span></h2>
    ${renderPrd(prdAcs)}
  </section>` : ""}

  ${(coverageGaps.missingScreens.length || coverageGaps.untestedActions.length) ? `
  <section>
    <h2>Coverage Gaps <span class="aud">PM / QA</span></h2>
    ${renderCoverageGaps(coverageGaps)}
  </section>` : ""}

  <section>
    <h2>Run Metadata <span class="aud">Debug</span></h2>
    <table>
      <tr><th>Live URL</th><td>${escapeHtml(meta.liveUrl)}</td></tr>
      <tr><th>Figma file</th><td>${escapeHtml(meta.figmaFileKey)}</td></tr>
      ${meta.startingFrameId ? `<tr><th>Starting frame (explicit)</th><td><code>${escapeHtml(meta.startingFrameId)}</code></td></tr>` : ""}
      ${meta.flowStartingPoints?.length ? `<tr><th>Prototype flows detected</th><td>${meta.flowStartingPoints.map((f) => escapeHtml(f.name || f.nodeId)).join(", ")}</td></tr>` : ""}
      <tr><th>Generated</th><td>${escapeHtml(now)}</td></tr>
      <tr><th>AI calls (text)</th><td>${aiStats?.textCalls ?? 0}</td></tr>
      <tr><th>AI calls (vision)</th><td>${aiStats?.visionCalls ?? 0}</td></tr>
      <tr><th>AI cache hits</th><td>${aiStats?.cacheHits ?? 0}</td></tr>
      <tr><th>Estimated cost</th><td>$${(aiStats?.cost ?? 0).toFixed(3)}</td></tr>
    </table>
  </section>

</div>
<footer>QA Agent · Generated ${escapeHtml(now)}</footer>

<script>
  document.querySelectorAll(".state-header").forEach((h) => {
    h.addEventListener("click", () => h.parentElement.classList.toggle("open"));
  });
</script>
</body></html>`;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function computeScore(findings, matches, functional) {
  const errs  = findings.filter((f) => f.severity === "error").length
              + (functional?.consoleErrors?.length ?? 0)
              + (functional?.brokenLinks?.length ?? 0);
  const warns = findings.filter((f) => f.severity === "warn").length
              + (functional?.formChecks?.length ?? 0);
  const totalChecks = findings.length + (functional?.testedUrls?.length ?? 0) * 3;
  if (totalChecks === 0) return { value: "N/A", noData: true, errors: errs, warns };
  const raw = 100 - Math.min(100, (errs * 5 + warns * 2));
  return { value: Math.max(0, Math.round(raw)), noData: false, errors: errs, warns };
}

function scoreColor(v) {
  if (v === "N/A") return "#f97316";
  if (v >= 85) return "#22c55e";
  if (v >= 65) return "#eab308";
  return "#ef4444";
}

function renderTopIssues(findings) {
  const top = findings.filter((f) => f.severity === "error").slice(0, 5);
  if (top.length === 0) return `<p style="color:var(--muted);font-size:13px;margin-top:14px">No critical issues found.</p>`;
  return `<div style="margin-top:14px"><div class="k" style="color:var(--muted);font-size:12px;margin-bottom:8px">TOP ISSUES</div>${
    top.map((f) => `<div class="finding error"><div class="desc">${escapeHtml(f.description)}</div></div>`).join("")
  }</div>`;
}

function renderStateGraph(states, matches) {
  if (states.length === 0) return `<p style="color:var(--muted)">No states captured.</p>`;
  const rows = states.map((s) => {
    const m = matches.find((x) => x.stateId === s.id);
    const status = m?.status ?? "unmatched";
    const parent = s.parent ? `from <code>${s.parent}</code>` : "root";
    return `<tr>
      <td><code>${escapeHtml(s.id)}</code></td>
      <td>${escapeHtml(s.triggerDesc)}</td>
      <td>${escapeHtml(s.url)}</td>
      <td><span class="pill ${status}">${status}</span></td>
      <td>${m?.frameName ? escapeHtml(m.frameName) : "—"}</td>
      <td>${m ? (m.confidence * 100).toFixed(0) + "%" : "—"}</td>
    </tr>`;
  }).join("");
  return `<table><thead><tr><th>ID</th><th>Trigger</th><th>URL</th><th>Status</th><th>Figma frame</th><th>Confidence</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderStateFindings(states, matches, allFindings, frames) {
  if (states.length === 0) return `<p style="color:var(--muted)">No data.</p>`;
  return states.map((s) => {
    const m        = matches.find((x) => x.stateId === s.id);
    const frame    = m?.frameId ? frames.find((f) => f.id === m.frameId) : null;
    const findings = allFindings.filter((f) => f.stateId === s.id);
    const errs     = findings.filter((f) => f.severity === "error").length;
    const warns    = findings.filter((f) => f.severity === "warn").length;

    // ── Screenshots always visible (not behind toggle) ────────────────────
    const liveImg = s.screenshot ? `
      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">
          LIVE SCREENSHOT · <span style="text-transform:none;font-weight:400">${escapeHtml(s.url)}</span>
        </div>
        <img src="data:image/png;base64,${s.screenshot}" alt="live screenshot"
          style="width:100%;border:2px solid #3b82f6;border-radius:8px;display:block">
      </div>` : "";

    const figmaImg = m?.framePng ? `
      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">
          FIGMA DESIGN · <span style="text-transform:none;font-weight:400">${escapeHtml(frame?.name ?? "—")} (${(m.confidence*100).toFixed(0)}% match)</span>
        </div>
        <img src="data:image/png;base64,${m.framePng}" alt="figma frame"
          style="width:100%;border:2px solid #22c55e;border-radius:8px;display:block;background:#fff">
      </div>` : `
      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">
          FIGMA DESIGN · <span style="text-transform:none;font-weight:400">no matching frame found</span>
        </div>
        <div style="width:100%;height:200px;border:2px dashed var(--border);border-radius:8px;
          display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:13px">
          No Figma frame matched this state
        </div>
      </div>`;

    const screenshotRow = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        ${liveImg}${figmaImg}
      </div>`;

    // ── Findings list ──────────────────────────────────────────────────────
    const findingsList = findings.length ? findings.map((f) => `
      <div class="finding ${f.severity}">
        <div class="head">
          <span>${escapeHtml((f.category || "general").toUpperCase())}</span>
          <span>·</span><span>${f.severity}</span>
        </div>
        <div class="desc">${escapeHtml(f.description)}</div>
        ${f.evidence ? `<div style="color:var(--muted);font-size:11px;margin-top:4px">${escapeHtml(String(f.evidence))}</div>` : ""}
      </div>`).join("") : `<p style="color:var(--muted);font-size:13px;margin:0">No visual/content issues detected for this state.</p>`;

    return `
    <div style="background:var(--panel-2);border:1px solid var(--border);border-radius:12px;margin-bottom:20px;overflow:hidden">
      <!-- State header — always visible -->
      <div style="padding:14px 18px;display:flex;justify-content:space-between;align-items:center;
                  border-bottom:1px solid var(--border);background:var(--panel)">
        <div>
          <div style="font-weight:700;font-size:15px">${escapeHtml(s.id)} — ${escapeHtml(s.triggerDesc)}</div>
          <div style="color:var(--muted);font-size:12px;margin-top:3px">${escapeHtml(s.url)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          ${frame ? `<span class="chip ok">Matched: ${escapeHtml(frame.name)}</span>` : `<span class="chip warn">No match</span>`}
          ${errs  ? `<span class="chip err">${errs} error${errs > 1 ? "s" : ""}</span>` : ""}
          ${warns ? `<span class="chip warn">${warns} warning${warns > 1 ? "s" : ""}</span>` : ""}
          ${!errs && !warns ? `<span class="chip ok">Clean</span>` : ""}
        </div>
      </div>
      <!-- Screenshots — always visible, side by side -->
      <div style="padding:16px 18px;border-bottom:1px solid var(--border)">
        ${screenshotRow}
      </div>
      <!-- Findings — collapsible -->
      <div style="padding:14px 18px">
        <div style="font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;
                    letter-spacing:.06em;margin-bottom:10px">Issues Found</div>
        ${findingsList}
      </div>
    </div>`;
  }).join("");
}

function renderFunctional(f) {
  if (!f) return `<p style="color:var(--muted)">Not run.</p>`;
  const blocks = [];

  if (f.consoleErrors?.length) {
    blocks.push(`<div class="k" style="color:var(--muted);margin:10px 0 6px">CONSOLE ERRORS (${f.consoleErrors.length})</div>`);
    for (const e of f.consoleErrors.slice(0, 8)) {
      blocks.push(`<div class="finding error"><div class="desc">${escapeHtml(e.message)}</div>
                   <div class="k" style="color:var(--muted);font-size:11px">${escapeHtml(e.url)}</div></div>`);
    }
  }
  if (f.networkErrors?.length) {
    blocks.push(`<div class="k" style="color:var(--muted);margin:10px 0 6px">NETWORK FAILURES (${f.networkErrors.length})</div>`);
    for (const e of f.networkErrors.slice(0, 8)) {
      blocks.push(`<div class="finding error"><div class="desc">${e.status} · ${escapeHtml(e.url.slice(0, 120))}</div></div>`);
    }
  }
  if (f.brokenLinks?.length) {
    blocks.push(`<div class="k" style="color:var(--muted);margin:10px 0 6px">BROKEN LINKS (${f.brokenLinks.length})</div>`);
    for (const e of f.brokenLinks) {
      blocks.push(`<div class="finding error"><div class="desc">${e.status} · ${escapeHtml(e.href)}</div></div>`);
    }
  }
  if (f.formChecks?.length) {
    blocks.push(`<div class="k" style="color:var(--muted);margin:10px 0 6px">FORM CHECKS (${f.formChecks.length})</div>`);
    for (const e of f.formChecks) {
      blocks.push(`<div class="finding warn"><div class="desc">${escapeHtml(e.issue)}</div>
                   <div class="k" style="color:var(--muted);font-size:11px">${escapeHtml(e.url)}</div></div>`);
    }
  }
  if (blocks.length === 0) return `<p style="color:var(--green)">All functional checks passed across ${f.testedUrls?.length ?? 0} URL(s).</p>`;
  return blocks.join("");
}

function renderA11y(f) {
  if (!f?.a11y?.length) return `<p style="color:var(--muted)">No accessibility scan data.</p>`;
  const all = f.a11y.flatMap(x => x.violations.map(v => ({ ...v, url: x.url })));
  if (!all.length) return `<p style="color:var(--green)">No critical/serious accessibility violations found.</p>`;
  return all.slice(0, 20).map((v) =>
    `<div class="finding ${v.impact === "critical" ? "error" : "warn"}">
       <div class="head"><span>${escapeHtml(v.id)}</span><span>·</span><span>${v.impact}</span></div>
       <div class="desc">${escapeHtml(v.description)}</div>
       <div class="k" style="color:var(--muted);font-size:11px">${escapeHtml(v.url)}</div>
     </div>`
  ).join("");
}

function renderPrd(acs) {
  return `<table>
    <thead><tr><th>ID</th><th>Criterion</th><th>Status</th><th>Evidence</th></tr></thead>
    <tbody>${acs.map((a) => `
      <tr>
        <td><code>${escapeHtml(a.id || "")}</code></td>
        <td>${escapeHtml(a.text)}</td>
        <td><span class="pill ${a.status}">${a.status}</span></td>
        <td>${a.evidence?.length ? a.evidence.map(e => `<code>${escapeHtml(e.stateId)}</code>`).join(" ") : "—"}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

// ─── frame-by-frame deep analysis (7 dimensions) ───────────────────────────

const DIM_META = {
  layoutStructure:    { label: "Layout & Structure",   icon: "⬛" },
  typography:         { label: "Typography",            icon: "🔤" },
  colors:             { label: "Colors",                icon: "🎨" },
  componentStyling:   { label: "Component Styling",     icon: "🧩" },
  iconsAssets:        { label: "Icons & Assets",        icon: "🖼" },
  interactionsStates: { label: "Interactions & States", icon: "👆" },
  contentAccuracy:    { label: "Content Accuracy",      icon: "📝" },
};

function renderFrameAnalyses(frameAnalyses) {
  if (!frameAnalyses.length) return `<p style="color:var(--muted)">No frame analyses available.</p>`;
  return frameAnalyses.map((fa) => renderOneFrameAnalysis(fa)).join("");
}

function renderOneFrameAnalysis(fa) {
  const a     = fa.analysis ?? {};
  const score = fa.frameScore ?? 0;
  const rc    = score >= 75 ? "#22c55e" : score >= 50 ? "#eab308" : "#ef4444";

  // Score ring
  const ring = `
    <div class="score-ring" style="border-color:${rc};color:${rc}">
      ${score}<span class="ring-label" style="color:var(--muted)">/100</span>
    </div>`;

  // Side-by-side screenshots
  const screenshots = (fa.liveScreenshot || fa.figmaScreenshot) ? `
    <div class="fa-screenshots">
      ${fa.liveScreenshot ? `
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;font-weight:600">
            LIVE · <span style="text-transform:none;font-weight:400">${escapeHtml(fa.liveUrl ?? "")}</span>
          </div>
          <img src="data:image/png;base64,${fa.liveScreenshot}"
               style="width:100%;border:2px solid #3b82f6;border-radius:8px;display:block">
        </div>` : ""}
      ${fa.figmaScreenshot ? `
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;font-weight:600">
            FIGMA · <span style="text-transform:none;font-weight:400">${escapeHtml(fa.frameName)}</span>
          </div>
          <img src="data:image/png;base64,${fa.figmaScreenshot}"
               style="width:100%;border:2px solid #22c55e;border-radius:8px;display:block;background:#fff">
        </div>` : `
        <div style="display:flex;align-items:center;justify-content:center;
                    border:2px dashed var(--border);border-radius:8px;color:var(--dim);font-size:13px;padding:40px">
          No Figma PNG (text+structure match only)
        </div>`}
    </div>` : "";

  // 7-dimension grid
  const dims = a.dimensions ?? {};
  const dimGrid = Object.entries(DIM_META).map(([key, meta]) => {
    const d    = dims[key] ?? { score: 0, status: "deviates", notes: "—", issues: [] };
    const dc   = d.score >= 75 ? "#22c55e" : d.score >= 50 ? "#eab308" : "#ef4444";
    const sc   = d.status === "matches" ? "status-matches" : d.status === "partial" ? "status-partial" : "status-deviates";
    const issues = (d.issues ?? []).map((iss) =>
      `<li style="font-size:12px;padding:3px 0;border-bottom:1px solid #1a2235;color:var(--text)">${escapeHtml(iss)}</li>`
    ).join("");
    return `
      <div class="fa-dim-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-weight:700;font-size:13px">${escapeHtml(meta.label)}</div>
            <span class="status-badge ${sc}" style="margin-top:4px;display:inline-block">${escapeHtml(d.status)}</span>
          </div>
          <div style="font-size:26px;font-weight:900;color:${dc};line-height:1">${d.score}</div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">${escapeHtml(d.notes)}</div>
        ${issues ? `<ul style="margin:0;padding:0 0 0 12px">${issues}</ul>` : ""}
      </div>`;
  }).join("");

  return `
  <div class="fa-frame">
    <div class="fa-header">
      <div style="flex:1">
        <h3 style="margin:0 0 4px 0">${escapeHtml(fa.stateId)} — ${escapeHtml(fa.frameName)}</h3>
        <div class="sub">${escapeHtml(fa.triggerDesc ?? "")} · ${escapeHtml(fa.liveUrl ?? "")}</div>
        ${fa.summary ? `<div style="font-size:13px;margin-top:8px;color:#94a3b8;font-style:italic">"${escapeHtml(fa.summary)}"</div>` : ""}
      </div>
      ${ring}
    </div>
    ${screenshots}
    <div style="padding:16px 22px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:12px">
        Dimension Analysis
      </div>
      <div class="fa-dim-grid">${dimGrid}</div>
    </div>
  </div>`;
}

// ─── combined assessment ────────────────────────────────────────────────────

function renderCombinedAssessment(frameAnalyses) {
  if (!frameAnalyses.length) return `<p style="color:var(--muted)">No analysis data.</p>`;

  const scores = frameAnalyses.map((fa) => fa.frameScore ?? 0);
  const avg    = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const color  = avg >= 75 ? "#22c55e" : avg >= 50 ? "#eab308" : "#ef4444";

  // Per-dimension averages across all frames
  const dimAvgs = {};
  for (const key of Object.keys(DIM_META)) {
    const vals = frameAnalyses
      .map((fa) => fa.analysis?.dimensions?.[key]?.score ?? 0)
      .filter((v) => v > 0);
    dimAvgs[key] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }

  // Build insights from dimension averages
  const insights = [];
  for (const [key, meta] of Object.entries(DIM_META)) {
    const avg2 = dimAvgs[key];
    if (avg2 < 50)
      insights.push(`${meta.label}: avg ${avg2}/100 — significant deviations across frames.`);
    else if (avg2 < 75)
      insights.push(`${meta.label}: avg ${avg2}/100 — partial match, review recommended.`);
  }
  const deviateCount = frameAnalyses.filter((fa) =>
    Object.values(fa.analysis?.dimensions ?? {}).some((d) => d.status === "deviates")
  ).length;
  if (deviateCount > 0)
    insights.push(`${deviateCount} frame(s) have at least one dimension deviating from the Figma design.`);
  if (insights.length === 0)
    insights.push("All analyzed dimensions are consistent with the Figma design — great job!");

  // Dimension summary bar
  const dimSummary = Object.entries(DIM_META).map(([key, meta]) => {
    const s  = dimAvgs[key];
    const c  = s >= 75 ? "#22c55e" : s >= 50 ? "#eab308" : "#ef4444";
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span>${escapeHtml(meta.label)}</span>
          <span style="font-weight:700;color:${c}">${s}/100</span>
        </div>
        <div style="background:#1a2235;border-radius:4px;height:6px">
          <div style="background:${c};height:6px;border-radius:4px;width:${s}%"></div>
        </div>
      </div>`;
  }).join("");

  // Per-frame score table
  const scoreTable = `
    <table style="margin-top:20px">
      <thead><tr><th>State</th><th>Figma Frame</th><th>Score</th>${Object.values(DIM_META).map((m) => `<th>${escapeHtml(m.label)}</th>`).join("")}</tr></thead>
      <tbody>
        ${frameAnalyses.map((fa) => {
          const s  = fa.frameScore ?? 0;
          const sc = s >= 75 ? "#22c55e" : s >= 50 ? "#eab308" : "#ef4444";
          const dimCells = Object.keys(DIM_META).map((key) => {
            const ds = fa.analysis?.dimensions?.[key]?.score ?? 0;
            const dc = ds >= 75 ? "#22c55e" : ds >= 50 ? "#eab308" : "#ef4444";
            return `<td style="font-weight:600;color:${dc};font-size:12px">${ds}</td>`;
          }).join("");
          return `<tr>
            <td><code>${escapeHtml(fa.stateId)}</code></td>
            <td style="font-size:12px">${escapeHtml(fa.frameName)}</td>
            <td style="font-weight:800;color:${sc}">${s}</td>
            ${dimCells}
          </tr>`;
        }).join("")}
        <tr style="border-top:2px solid var(--border);background:var(--panel)">
          <td colspan="2" style="font-weight:700">COMBINED AVERAGE</td>
          <td style="font-weight:900;font-size:18px;color:${color}">${avg}</td>
          ${Object.keys(DIM_META).map((k) => {
            const s = dimAvgs[k]; const c = s >= 75 ? "#22c55e" : s >= 50 ? "#eab308" : "#ef4444";
            return `<td style="font-weight:700;color:${c};font-size:12px">${s}</td>`;
          }).join("")}
        </tr>
      </tbody>
    </table>`;

  return `
    <div class="combined">
      <div class="combined-score">
        <div class="big-score" style="color:${color}">${avg}</div>
        <div class="label">Overall Score</div>
        <div style="font-size:12px;color:var(--dim);margin-top:4px">${frameAnalyses.length} frame(s)</div>
      </div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;
                    letter-spacing:.08em;margin-bottom:12px">Dimension Averages</div>
        ${dimSummary}
      </div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;
                  letter-spacing:.08em;margin-bottom:10px">Key Insights</div>
      <ul class="insight-list">
        ${insights.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}
      </ul>
    </div>
    ${scoreTable}`;
}

// ─── coverage gaps ──────────────────────────────────────────────────────────

function renderCoverageGaps({ missingScreens, untestedActions }) {
  const blocks = [];

  if (missingScreens?.length) {
    blocks.push(`
      <div style="margin-bottom:18px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
                    color:var(--red);margin-bottom:10px">
          Missing Screens — ${missingScreens.length}
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 10px 0">
          These screens are described in the PRD but no matching state was captured during exploration.
        </p>
        ${missingScreens.map((s) => `
          <div class="finding error" style="display:flex;align-items:center;gap:10px">
            <span style="font-size:18px;flex-shrink:0">📭</span>
            <div>
              <div class="desc">${escapeHtml(s)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">Not captured — check if the screen is reachable from the source URL</div>
            </div>
          </div>`).join("")}
      </div>`);
  }

  if (untestedActions?.length) {
    blocks.push(`
      <div>
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
                    color:var(--yellow);margin-bottom:10px">
          Untested Interactions — ${untestedActions.length}
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 10px 0">
          These user interactions are described in the PRD but were never triggered during exploration.
        </p>
        ${untestedActions.map((a) => `
          <div class="finding warn" style="display:flex;align-items:center;gap:10px">
            <span style="font-size:18px;flex-shrink:0">🔲</span>
            <div>
              <div class="desc">${escapeHtml(a)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">Not triggered — the explorer may not have found the relevant element</div>
            </div>
          </div>`).join("")}
      </div>`);
  }

  return blocks.join("") || `<p style="color:var(--green)">All PRD-described screens and interactions were covered.</p>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
