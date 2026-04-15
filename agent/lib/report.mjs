/**
 * Report generator
 * Produces a self-contained HTML file with two views:
 *   Designer: annotated screenshots, visual diffs, per-property tables
 *   PM:       plain English findings, AC checklist, interaction results
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function scoreColor(s) {
  if (s >= 80) return "#22c55e";
  if (s >= 60) return "#f59e0b";
  return "#ef4444";
}

function severityBadge(s) {
  const map = { error: ["#ef4444","ERROR"], warn: ["#f59e0b","WARN"], pass: ["#22c55e","PASS"] };
  const [color, label] = map[s] ?? ["#94a3b8","INFO"];
  return `<span class="badge" style="background:${color}22;color:${color}">${label}</span>`;
}

function calcScore(findings) {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warns  = findings.filter((f) => f.severity === "warn").length;
  const passes = findings.filter((f) => f.severity === "pass").length;
  const total  = errors + warns + passes;
  const score  = total === 0 ? 100 : Math.max(0, Math.round(100 - ((errors * 3 + warns) / (total || 1)) * 100));
  return { score, errors, warns, passes };
}

export function generateReport(runData) {
  const { runId, screens, meta, prd } = runData;
  const allFindings = screens.flatMap((s) => s.phase1?.findings ?? []);
  const { score, errors, warns, passes } = calcScore(allFindings);

  const screenTabs = screens.map((s, i) =>
    `<button class="tab-btn ${i === 0 ? "active" : ""}" onclick="showScreen(${i})">${esc(s.name)}</button>`
  ).join("");

  const screenPanels = screens.map((s, i) => buildScreenPanel(s, i)).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>QA Report — ${esc(meta.liveUrl)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;line-height:1.5}
a{color:#60a5fa}
.header{background:#161b27;border-bottom:1px solid #1e2640;padding:20px 32px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.header-score{font-size:52px;font-weight:800;color:${scoreColor(score)};line-height:1}
.header-meta h1{font-size:18px;font-weight:700}
.header-meta p{font-size:12px;color:#64748b;margin-top:3px}
.meta-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.chip{background:#1e2640;border:1px solid #2d3660;border-radius:6px;padding:3px 10px;font-size:12px;color:#94a3b8}
.share-btn{margin-left:auto;background:#3b4fd8;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;cursor:pointer;font-weight:600}
.share-btn:hover{background:#4b5fe8}

.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;padding:20px 32px}
.stat-card{background:#161b27;border:1px solid #1e2640;border-radius:12px;padding:18px 20px}
.stat-card h3{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:10px}
.stat-num{font-size:36px;font-weight:800;line-height:1}
.stat-label{font-size:12px;color:#64748b;margin-top:3px}

.view-toggle{padding:0 32px 0;display:flex;gap:6px;border-bottom:1px solid #1e2640;padding-bottom:0}
.view-btn{background:none;border:none;border-bottom:2px solid transparent;color:#64748b;padding:12px 18px;font-size:14px;cursor:pointer;font-weight:500;transition:all .15s}
.view-btn.active{color:#e2e8f0;border-bottom-color:#3b4fd8}

.screen-tabs{padding:16px 32px 0;display:flex;gap:6px;flex-wrap:wrap}
.tab-btn{background:#1e2640;border:1px solid #2d3660;border-radius:6px;padding:6px 14px;font-size:13px;color:#94a3b8;cursor:pointer;transition:all .15s}
.tab-btn:hover{background:#2d3660;color:#e2e8f0}
.tab-btn.active{background:#3b4fd8;border-color:#3b4fd8;color:#fff}

.screen-panel{display:none;padding:20px 32px 40px}
.screen-panel.active{display:block}

.phase-tabs{display:flex;gap:4px;margin-bottom:20px;flex-wrap:wrap}
.phase-tab{background:none;border:1px solid #2d3660;border-radius:6px;padding:5px 14px;font-size:12px;color:#64748b;cursor:pointer}
.phase-tab.active{background:#1e2640;color:#e2e8f0;border-color:#3b4fd8}

.phase-panel{display:none}
.phase-panel.active{display:block}

.diff-block{background:#161b27;border:1px solid #1e2640;border-radius:12px;margin-bottom:20px;overflow:hidden}
.diff-header{padding:14px 18px;border-bottom:1px solid #1e2640;display:flex;align-items:center;gap:10px}
.diff-header h3{font-size:14px;font-weight:600}
.diff-header .score{font-size:20px;font-weight:700}
.img-tabs{display:flex;gap:4px;padding:12px 18px 0}
.img-tab{background:#1e2640;border:1px solid #2d3660;border-radius:5px;padding:4px 12px;font-size:12px;color:#94a3b8;cursor:pointer}
.img-tab.active{background:#2d3660;color:#e2e8f0}
.img-panel{padding:16px 18px}
.img-panel img{max-width:100%;border-radius:6px;border:1px solid #1e2640}
.side-by-side{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.img-label{font-size:11px;color:#64748b;margin-bottom:6px}

.slider-container{position:relative;display:inline-block;user-select:none;cursor:col-resize;max-width:100%}
.slider-img{display:block;max-width:100%;border-radius:6px;border:1px solid #1e2640}
.slider-overlay{position:absolute;top:0;left:0;height:100%;overflow:hidden;border-right:2px solid #60a5fa}
.slider-overlay img{max-width:none;position:absolute;top:0;left:0}
.slider-handle{position:absolute;top:0;width:2px;height:100%;background:#60a5fa;cursor:col-resize}
.slider-handle::after{content:'◀ ▶';position:absolute;top:50%;transform:translate(-50%,-50%);background:#60a5fa;color:#000;font-size:10px;padding:3px 6px;border-radius:4px;white-space:nowrap}
.slider-label{position:absolute;top:8px;background:rgba(0,0,0,.7);color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;pointer-events:none}
.slider-label.left{left:8px}
.slider-label.right{right:8px}

.findings-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
.findings-table th{background:#1e2640;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;position:sticky;top:0}
.findings-table td{padding:8px 12px;border-top:1px solid #1a1f32;vertical-align:top}
.findings-table .err-row{background:rgba(239,68,68,.03)}
.findings-table .wrn-row{background:rgba(245,158,11,.03)}
.mono{font-family:monospace;font-size:12px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.tag{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;background:#1e2640;color:#94a3b8}
.pass-row{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #1a1f32;font-size:13px}
.pass-icon{color:#22c55e;font-size:16px}
.fail-icon{color:#ef4444;font-size:16px}
.warn-icon{color:#f59e0b;font-size:16px}
.perf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
.perf-card{background:#1e2640;border-radius:8px;padding:14px}
.perf-card .metric{font-size:24px;font-weight:700}
.perf-card .label{font-size:11px;color:#64748b;margin-top:3px}
.perf-card .rating{font-size:11px;margin-top:4px;font-weight:600}
.good{color:#22c55e}.needs-improvement{color:#f59e0b}.poor{color:#ef4444}
.ac-row{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid #1a1f32;align-items:flex-start}
.ac-id{font-family:monospace;font-size:12px;color:#60a5fa;white-space:nowrap;padding-top:2px}
.ac-desc{font-size:13px;flex:1}
.ac-status{font-size:11px;font-weight:600;white-space:nowrap;padding-top:2px}
.section-title{font-size:14px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin:20px 0 10px}
.copy-row{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;padding:8px 12px;border-bottom:1px solid #1a1f32;font-size:13px;align-items:center}
.view-container{display:none}
.view-container.active{display:block}
@media(max-width:768px){.side-by-side{grid-template-columns:1fr}.summary{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>

<div class="header">
  <div class="header-score">${score}<span style="font-size:24px;color:#64748b">%</span></div>
  <div class="header-meta">
    <h1>Frontend QA Report</h1>
    <p>${new Date().toLocaleString()}</p>
    <div class="meta-chips">
      <span class="chip">Live: ${esc(meta.liveUrl)}</span>
      <span class="chip">Figma: ${esc(meta.figmaFileKey ?? "—")}</span>
      <span class="chip">${screens.length} screens</span>
      <span class="chip">${errors} errors · ${warns} warnings</span>
    </div>
  </div>
  <button class="share-btn" onclick="copyShareLink()">🔗 Copy Share Link</button>
</div>

<div class="summary">
  <div class="stat-card"><h3>Overall Score</h3><div class="stat-num" style="color:${scoreColor(score)}">${score}%</div><div class="stat-label">across all phases</div></div>
  <div class="stat-card"><h3>Errors</h3><div class="stat-num" style="color:#ef4444">${errors}</div><div class="stat-label">must fix</div></div>
  <div class="stat-card"><h3>Warnings</h3><div class="stat-num" style="color:#f59e0b">${warns}</div><div class="stat-label">should fix</div></div>
  <div class="stat-card"><h3>Passes</h3><div class="stat-num" style="color:#22c55e">${passes}</div><div class="stat-label">looking good</div></div>
</div>

<div class="view-toggle">
  <button class="view-btn active" onclick="showView('designer')">Designer View</button>
  <button class="view-btn" onclick="showView('pm')">PM View</button>
</div>

<div id="view-designer" class="view-container active">
  <div class="screen-tabs">${screenTabs}</div>
  ${screenPanels}
</div>

<div id="view-pm" class="view-container">
  ${buildPmView(screens, prd)}
</div>

<script>
${sliderScript()}
${tabScript()}
function copyShareLink(){
  navigator.clipboard?.writeText(window.location.href).then(()=>{
    const btn=document.querySelector('.share-btn');
    btn.textContent='✓ Copied!';
    setTimeout(()=>{btn.textContent='🔗 Copy Share Link'},2000);
  });
}
</script>
</body>
</html>`;
}

function buildScreenPanel(screen, screenIdx) {
  const findings = screen.phase1?.findings ?? [];
  const { score, errors, warns } = calcScore(findings);

  return `
<div id="screen-${screenIdx}" class="screen-panel ${screenIdx === 0 ? "active" : ""}">
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
    <h2 style="font-size:18px;font-weight:700">${esc(screen.name)}</h2>
    <span style="font-size:20px;font-weight:700;color:${scoreColor(score)}">${score}%</span>
    <span style="font-size:13px;color:#64748b">${esc(screen.url)}</span>
  </div>

  <div class="phase-tabs">
    <button class="phase-tab active" onclick="showPhase(${screenIdx},0)">Phase 1 · Visual</button>
    <button class="phase-tab" onclick="showPhase(${screenIdx},1)">Phase 2 · Functional</button>
    <button class="phase-tab" onclick="showPhase(${screenIdx},2)">Phase 3 · QA</button>
    <button class="phase-tab" onclick="showPhase(${screenIdx},3)">Phase 4 · PRD</button>
  </div>

  <!-- Phase 1 -->
  <div id="phase-${screenIdx}-0" class="phase-panel active">
    ${buildVisualPanel(screen, screenIdx)}
  </div>

  <!-- Phase 2 -->
  <div id="phase-${screenIdx}-1" class="phase-panel">
    ${buildFunctionalPanel(screen)}
  </div>

  <!-- Phase 3 -->
  <div id="phase-${screenIdx}-2" class="phase-panel">
    ${buildQaPanel(screen)}
  </div>

  <!-- Phase 4 -->
  <div id="phase-${screenIdx}-3" class="phase-panel">
    ${buildPrdPanel(screen)}
  </div>
</div>`;
}

function buildVisualPanel(screen, sIdx) {
  const findings = screen.phase1?.findings ?? [];
  const figmaB64 = screen.phase1?.figmaScreenshot ?? "";
  const liveB64  = screen.captureData?.fullPageScreenshot ?? "";
  const annotB64 = screen.phase1?.annotatedScreenshot ?? "";

  const imgSection = figmaB64 && liveB64 ? `
    <div class="diff-block">
      <div class="diff-header">
        <h3>Screenshot Comparison</h3>
      </div>
      <div class="img-tabs">
        <button class="img-tab active" onclick="showImgTab(${sIdx},'side')">Side by Side</button>
        <button class="img-tab" onclick="showImgTab(${sIdx},'slider')">Slider</button>
        ${annotB64 ? `<button class="img-tab" onclick="showImgTab(${sIdx},'annot')">Annotated</button>` : ""}
      </div>
      <div id="imgtab-${sIdx}-side" class="img-panel">
        <div class="side-by-side">
          <div><div class="img-label">Figma Design</div><img src="data:image/png;base64,${figmaB64}"/></div>
          <div><div class="img-label">Live UI</div><img src="data:image/png;base64,${liveB64}"/></div>
        </div>
      </div>
      <div id="imgtab-${sIdx}-slider" class="img-panel" style="display:none">
        <div class="slider-container" id="slider-${sIdx}">
          <img class="slider-img" src="data:image/png;base64,${liveB64}" alt="Live"/>
          <div class="slider-overlay" id="soverlay-${sIdx}" style="width:50%">
            <img src="data:image/png;base64,${figmaB64}" alt="Figma" style="width:${screen.phase1?.figmaWidth ?? 1440}px"/>
          </div>
          <div class="slider-handle" id="shandle-${sIdx}" style="left:50%"></div>
          <div class="slider-label left">Figma</div>
          <div class="slider-label right">Live</div>
        </div>
      </div>
      ${annotB64 ? `
      <div id="imgtab-${sIdx}-annot" class="img-panel" style="display:none">
        <div class="img-label">Live UI — annotated (red=error, orange=warning)</div>
        <img src="data:image/png;base64,${annotB64}"/>
      </div>` : ""}
    </div>` : `<p style="color:#64748b;padding:12px 0">No screenshot comparison available</p>`;

  const findingRows = findings.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:20px;color:#22c55e">✓ No visual issues found</td></tr>`
    : findings.sort((a, b) => (a.severity === "error" ? -1 : b.severity === "error" ? 1 : 0))
        .map((f) => `
        <tr class="${f.severity === "error" ? "err-row" : f.severity === "warn" ? "wrn-row" : ""}">
          <td>${severityBadge(f.severity)}</td>
          <td><span class="tag">${esc(f.category)}</span></td>
          <td class="mono">${esc(f.property)}</td>
          <td class="mono" style="color:#818cf8">${esc(f.figmaValue)}</td>
          <td class="mono" style="color:#34d399">${esc(f.liveValue)}</td>
          <td class="mono" style="color:#f59e0b">${esc(f.delta)}</td>
        </tr>
        <tr><td colspan="6" style="font-size:12px;color:#64748b;padding:2px 12px 10px;font-style:italic;border-top:none">${esc(f.description)}</td></tr>`
        ).join("");

  return `
    ${imgSection}
    <h3 class="section-title">Findings (${findings.length})</h3>
    <div style="overflow-x:auto">
    <table class="findings-table">
      <thead><tr>
        <th>Severity</th><th>Category</th><th>Property</th>
        <th style="color:#818cf8">Figma</th><th style="color:#34d399">Live</th><th>Delta</th>
      </tr></thead>
      <tbody>${findingRows}</tbody>
    </table></div>`;
}

function buildFunctionalPanel(screen) {
  const tests = screen.phase2 ?? [];
  if (tests.length === 0) return `<p style="color:#64748b;padding:12px 0">No functional tests ran for this screen.</p>`;

  return tests.map((t) => `
    <div style="background:#161b27;border:1px solid #1e2640;border-radius:10px;margin-bottom:14px;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid #1e2640;display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">${t.passed ? "✅" : "❌"}</span>
        <strong style="font-size:14px">${esc(t.name)}</strong>
        <span class="tag">${esc(t.category)}</span>
        ${t.errorMessage ? `<span style="font-size:12px;color:#ef4444;margin-left:auto">${esc(t.errorMessage)}</span>` : ""}
      </div>
      ${t.beforeScreenshot && t.afterScreenshot ? `
      <div style="padding:14px 16px">
        <div class="side-by-side">
          <div><div class="img-label">Before</div><img src="data:image/png;base64,${t.beforeScreenshot}" style="max-width:100%;border-radius:6px;border:1px solid #1e2640"/></div>
          <div><div class="img-label">After</div><img src="data:image/png;base64,${t.afterScreenshot}" style="max-width:100%;border-radius:6px;border:1px solid #1e2640"/></div>
        </div>
        ${t.afterUrl ? `<p style="font-size:12px;color:#64748b;margin-top:8px">Navigated to: ${esc(t.afterUrl)}</p>` : ""}
      </div>` : ""}
    </div>`
  ).join("");
}

function buildQaPanel(screen) {
  const qa = screen.phase3;
  if (!qa) return `<p style="color:#64748b;padding:12px 0">QA checks did not run.</p>`;

  const perf = qa.performance;
  const perfSection = perf ? `
    <h3 class="section-title">Performance</h3>
    <div class="perf-grid">
      ${[
        ["LCP", perf.lcp + "ms", perf.ratings?.lcp],
        ["FCP", perf.fcp + "ms", perf.ratings?.fcp],
        ["CLS", String(perf.cls ?? "—"), perf.ratings?.cls],
        ["TTFB", perf.ttfb != null ? perf.ttfb + "ms" : "—", perf.ratings?.ttfb],
        ["Load", perf.loadMs + "ms", perf.loadMs < 3000 ? "good" : "needs-improvement"],
      ].map(([label, val, rating]) => `
        <div class="perf-card">
          <div class="metric ${rating}">${esc(val)}</div>
          <div class="label">${esc(label)}</div>
          <div class="rating ${rating}">${esc(rating ?? "—")}</div>
        </div>`).join("")}
    </div>
    ${perf.consoleErrors?.length ? `
    <p style="font-size:13px;color:#ef4444;margin-bottom:8px">⚠ ${perf.consoleErrors.length} console error(s)</p>
    ${perf.consoleErrors.map((e) => `<code style="display:block;font-size:11px;color:#f87171;background:#1e2640;padding:4px 8px;border-radius:4px;margin-bottom:4px">${esc(e)}</code>`).join("")}` : ""}` : "";

  const a11yItems = qa.accessibility ?? [];
  const a11ySection = `
    <h3 class="section-title">Accessibility (WCAG AA) — ${a11yItems.filter((i) => i.severity === "error").length} errors</h3>
    ${a11yItems.length === 0
      ? `<p style="color:#22c55e;font-size:13px">✓ No accessibility issues detected</p>`
      : a11yItems.slice(0, 20).map((i) => `
        <div class="pass-row">
          <span class="${i.severity === "error" ? "fail-icon" : "warn-icon"}">${i.severity === "error" ? "✗" : "⚠"}</span>
          <div>
            <div style="font-size:13px">${esc(i.description)}</div>
            ${i.wcag ? `<div style="font-size:11px;color:#64748b;margin-top:2px">WCAG ${esc(i.wcag)} · ${esc(i.type)}</div>` : ""}
          </div>
        </div>`).join("")}`;

  const respSection = `
    <h3 class="section-title">Responsiveness</h3>
    <div class="side-by-side" style="gap:12px;margin-bottom:16px">
      ${(qa.responsiveness ?? []).map((r) => `
        <div>
          <div class="img-label">${esc(r.viewport.label)} (${r.viewport.width}px)
            ${r.issues.length > 0 ? `<span style="color:#ef4444;margin-left:6px">${r.issues.length} issue(s)</span>` : `<span style="color:#22c55e;margin-left:6px">✓</span>`}
          </div>
          <img src="data:image/png;base64,${r.screenshot}" style="max-width:100%;border-radius:6px;border:1px solid #1e2640"/>
        </div>`).join("")}
    </div>`;

  return perfSection + a11ySection + respSection;
}

function buildPrdPanel(screen) {
  const prd = screen.phase4;
  if (!prd || prd.skipped) {
    return `<div style="background:#1e2640;border-radius:10px;padding:20px;text-align:center;color:#64748b">
      <p style="font-size:24px;margin-bottom:8px">📄</p>
      <p>No PRD provided. Upload a PRD PDF when running the agent to enable AC checklist and copy validation.</p>
    </div>`;
  }

  const acRows = (prd.acceptanceCriteria ?? []).map((ac) => `
    <div class="ac-row">
      <span class="ac-id">${esc(ac.id)}</span>
      <span class="ac-desc">${esc(ac.description)}</span>
      <span class="ac-status ${ac.status === "pass" ? "good" : ac.status === "fail" ? "poor" : "needs-improvement"}">
        ${ac.status === "pass" ? "✓ PASS" : ac.status === "fail" ? "✗ FAIL" : "👁 MANUAL"}
      </span>
    </div>`).join("");

  const copyRows = (prd.copyValidation ?? []).map((c) => `
    <div class="copy-row">
      <span style="color:#94a3b8">${esc(c.location)}</span>
      <span class="mono">${esc(c.expectedText)}</span>
      <span style="color:${c.found ? "#22c55e" : "#f59e0b"}">${c.found ? "✓" : "✗ missing"}</span>
    </div>`).join("");

  const navRows = (prd.navigationCheck ?? []).map((n) => `
    <div class="pass-row">
      <span class="${n.passed ? "pass-icon" : "fail-icon"}">${n.passed ? "✓" : "✗"}</span>
      <span style="font-family:monospace;font-size:12px">${esc(n.url.replace(/^https?:\/\/[^/]+/, ""))}</span>
      <span style="font-size:12px;color:#64748b;margin-left:auto">${n.text ? esc(n.text) : ""} · ${n.status}</span>
    </div>`).join("");

  return `
    <h3 class="section-title">Acceptance Criteria (${prd.acceptanceCriteria?.length ?? 0})</h3>
    ${acRows || `<p style="color:#64748b;font-size:13px">No acceptance criteria extracted from PRD.</p>`}

    <h3 class="section-title">Copy Validation</h3>
    ${copyRows || `<p style="color:#64748b;font-size:13px">No expected copy extracted from PRD.</p>`}

    <h3 class="section-title">Navigation Check</h3>
    ${navRows || `<p style="color:#64748b;font-size:13px">No navigation links checked.</p>`}`;
}

function buildPmView(screens, prd) {
  const allFindings = screens.flatMap((s) => s.phase1?.findings ?? []);
  const { score, errors, warns } = calcScore(allFindings);

  return `
    <div style="padding:24px 32px">
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px">Executive Summary</h2>
      <p style="color:#94a3b8;margin-bottom:20px;font-size:14px">
        Automated QA run across ${screens.length} screen(s). Overall health: <strong style="color:${scoreColor(score)}">${score}%</strong>.
        ${errors > 0 ? `<strong style="color:#ef4444">${errors} critical issue(s)</strong> require immediate attention. ` : ""}
        ${warns > 0 ? `${warns} warning(s) should be addressed before launch.` : ""}
      </p>

      ${screens.map((s) => {
        const sFindings = s.phase1?.findings ?? [];
        const { score: ss, errors: se, warns: sw } = calcScore(sFindings);
        const ftResults = s.phase2 ?? [];
        const failed = ftResults.filter((t) => !t.passed);

        return `
        <div style="background:#161b27;border:1px solid #1e2640;border-radius:12px;margin-bottom:20px;padding:20px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <h3 style="font-size:16px;font-weight:700">${esc(s.name)}</h3>
            <span style="font-size:22px;font-weight:800;color:${scoreColor(ss)}">${ss}%</span>
          </div>

          ${se > 0 || sw > 0 ? `
          <h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:8px">Issues to Fix</h4>
          ${sFindings.filter((f) => f.severity !== "pass").slice(0, 8).map((f) => `
            <div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #1a1f32;font-size:13px">
              <span>${f.severity === "error" ? "🔴" : "🟡"}</span>
              <span>${esc(f.description)}</span>
            </div>`).join("")}` : `<p style="color:#22c55e;font-size:13px">✓ No visual issues on this screen</p>`}

          ${failed.length > 0 ? `
          <h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:12px 0 8px">Failed Interaction Tests</h4>
          ${failed.map((t) => `
            <div style="display:flex;gap:8px;padding:6px 0;font-size:13px">
              <span>❌</span><span>${esc(t.name)}: ${esc(t.errorMessage ?? "failed")}</span>
            </div>`).join("")}` : ""}
        </div>`;
      }).join("")}
    </div>`;
}

function sliderScript() {
  return `
function initSlider(idx){
  const c=document.getElementById('slider-'+idx);
  const ov=document.getElementById('soverlay-'+idx);
  const h=document.getElementById('shandle-'+idx);
  if(!c||c.dataset.init)return;
  c.dataset.init='1';
  const setPos=x=>{
    const r=c.getBoundingClientRect();
    const pct=Math.min(100,Math.max(0,((x-r.left)/r.width)*100));
    ov.style.width=pct+'%';h.style.left=pct+'%';
  };
  c.addEventListener('mousedown',e=>{
    e.preventDefault();setPos(e.clientX);
    const mv=e2=>setPos(e2.clientX);
    const up=()=>{window.removeEventListener('mousemove',mv);window.removeEventListener('mouseup',up)};
    window.addEventListener('mousemove',mv);window.addEventListener('mouseup',up);
  });
  c.addEventListener('touchstart',e=>{
    const mv=e2=>setPos(e2.touches[0].clientX);
    const en=()=>{window.removeEventListener('touchmove',mv);window.removeEventListener('touchend',en)};
    window.addEventListener('touchmove',mv);window.addEventListener('touchend',en);
  },{passive:true});
}`;
}

function tabScript() {
  return `
function showScreen(idx){
  document.querySelectorAll('.screen-panel').forEach((p,i)=>{p.classList.toggle('active',i===idx)});
  document.querySelectorAll('.screen-tabs .tab-btn').forEach((b,i)=>{b.classList.toggle('active',i===idx)});
}
function showPhase(sIdx,pIdx){
  const panel=document.getElementById('screen-'+sIdx);
  if(!panel)return;
  panel.querySelectorAll('.phase-panel').forEach((p,i)=>{p.classList.toggle('active',i===pIdx)});
  panel.querySelectorAll('.phase-tab').forEach((b,i)=>{b.classList.toggle('active',i===pIdx)});
}
function showImgTab(sIdx,name){
  ['side','slider','annot'].forEach(t=>{
    const el=document.getElementById('imgtab-'+sIdx+'-'+t);
    if(el)el.style.display=t===name?'':'none';
  });
  if(name==='slider')initSlider(sIdx);
}
function showView(name){
  document.querySelectorAll('.view-container').forEach(el=>{el.classList.toggle('active',el.id==='view-'+name)});
  document.querySelectorAll('.view-btn').forEach((b,i)=>{b.classList.toggle('active',['designer','pm'][i]===name)});
}`;
}
