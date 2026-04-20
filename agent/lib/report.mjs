/**
 * Report generator — industry-ready redesign.
 *
 * Layout:
 *   L1  Sticky nav  (Summary | Screens | Checks)
 *   L2  Hero band   (overall score · stats · 7-dim aggregate chips)
 *   L3  Screen cards (sorted worst-first, flat — no tabs)
 *       · Failing dims expanded with issues inline
 *       · Passing dims collapsed to one green line
 *       · Screenshots + CSS table as inline toggles
 *   L4  Footer accordions (Functional · PRD · Run Info)
 */

export function generateReport({
  runId, meta, frames, states, matches, findings, frameAnalyses = [],
  functional, prdAcs, coverageGaps = { missingScreens: [], untestedActions: [] },
  aiStats, warnings = [],
}) {
  const now = new Date().toISOString();

  // ── Aggregate stats ──────────────────────────────────────────────────────────
  const compared   = matches.filter(m => m.status === "matched" || m.status === "review");
  const unmatched  = matches.filter(m => m.status === "unmatched");
  const avgScore   = frameAnalyses.length
    ? Math.round(frameAnalyses.reduce((a, f) => a + (f.frameScore ?? 0), 0) / frameAnalyses.length)
    : null;
  const failingCards = frameAnalyses.filter(f => (f.frameScore ?? 100) < 60).length;
  const reviewCards  = frameAnalyses.filter(f => { const s = f.frameScore ?? 100; return s >= 60 && s < 80; }).length;
  const totalIssues  = findings.filter(f => f.severity === "error" || f.severity === "warn").length;

  // Aggregate per-dimension score across all frames
  const dimAgg = {};
  for (const fa of frameAnalyses) {
    for (const [key, dim] of Object.entries(fa.analysis?.dimensions ?? {})) {
      if (!dimAgg[key]) dimAgg[key] = [];
      dimAgg[key].push(dim.score ?? 0);
    }
  }

  const hasFunctional = functional && (
    (functional.consoleErrors?.length ?? 0) +
    (functional.networkErrors?.length  ?? 0) +
    (functional.brokenLinks?.length    ?? 0) +
    (functional.a11y?.flatMap(x => x.violations)?.length ?? 0)
  ) > 0;

  const hasPrd = prdAcs?.length > 0 ||
    coverageGaps.missingScreens?.length > 0 ||
    coverageGaps.untestedActions?.length > 0;

  const sc = avgScore;
  const scoreColor  = sc === null ? V.muted : sc >= 80 ? V.green : sc >= 60 ? V.amber : V.red;
  const scoreVerdict = sc === null ? "No data" : sc >= 80 ? "Passing" : sc >= 60 ? "Needs review" : "Failing";

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Report · ${esc(runId)}</title>
<style>${CSS}</style>
</head><body>

<!-- NAV -->
<nav id="topnav">
  <div class="nav-inner">
    <span class="nav-brand">QA Report</span>
    <div class="nav-links">
      <a href="#summary">Summary</a>
      <a href="#screens">Screens</a>
      ${hasFunctional || hasPrd ? `<a href="#checks">Checks</a>` : ""}
      <a href="#runinfo">Run Info</a>
    </div>
    <span class="nav-run">${esc(runId)}</span>
  </div>
</nav>

<main>

${warnings.length ? `
<div class="warn-banner">
  <span class="warn-icon">⚠</span>
  <span>${warnings.map(w => `<strong>${esc(w.step)}:</strong> ${esc(w.message.slice(0,160))}`).join(" · ")}</span>
</div>` : ""}

<!-- L2: HERO SUMMARY BAND -->
<section id="summary" class="hero-band">
  <div class="hero-left">
    <div class="score-ring" style="--sc:${scoreColor}">
      <span class="score-num">${sc ?? "—"}</span>
      <span class="score-denom">/100</span>
    </div>
    <span class="score-verdict" style="color:${scoreColor}">${scoreVerdict}</span>
  </div>
  <div class="hero-right">
    <div class="hero-title">Frontend QA Report</div>
    <div class="hero-meta">${esc(meta.liveUrl)} · ${esc(now.slice(0,10))}</div>
    <div class="hero-stats">
      <div class="stat-pill"><span class="stat-val">${compared.length}</span><span class="stat-lbl">screens</span></div>
      ${failingCards ? `<div class="stat-pill red"><span class="stat-val">${failingCards}</span><span class="stat-lbl">failing</span></div>` : ""}
      ${reviewCards  ? `<div class="stat-pill amber"><span class="stat-val">${reviewCards}</span><span class="stat-lbl">review</span></div>` : ""}
      ${totalIssues  ? `<div class="stat-pill"><span class="stat-val">${totalIssues}</span><span class="stat-lbl">issues</span></div>` : ""}
      ${unmatched.length ? `<div class="stat-pill muted"><span class="stat-val">${unmatched.length}</span><span class="stat-lbl">unmatched</span></div>` : ""}
    </div>
    <div class="dim-chips">
      ${Object.entries(DIM_META).map(([key, { label }]) => {
        const scores = dimAgg[key] ?? [];
        const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        const col = avg === null ? V.muted : avg >= 80 ? V.green : avg >= 60 ? V.amber : V.red;
        const bg  = avg === null ? "rgba(113,113,122,.1)" : avg >= 80 ? "rgba(16,185,129,.1)" : avg >= 60 ? "rgba(245,158,11,.1)" : "rgba(244,63,94,.1)";
        const icon = avg === null ? "—" : avg >= 80 ? "✓" : "✗";
        return `<span class="dim-chip" style="color:${col};background:${bg};border-color:${col}" data-dim="${key}">
          <span class="dim-chip-icon">${icon}</span>${esc(label)}${avg !== null ? ` <span class="dim-chip-score">${avg}</span>` : ""}
        </span>`;
      }).join("")}
    </div>
  </div>
</section>

<!-- L3: SCREEN CARDS -->
<section id="screens">
  <div class="section-header">
    <h2>Screen Comparisons</h2>
    <span class="section-sub">${compared.length} screen${compared.length !== 1 ? "s" : ""} · sorted by fidelity</span>
  </div>
  ${renderScreenCards(states, matches, findings, frames, frameAnalyses)}
  ${unmatched.length ? `
  <div class="unmatched-note">
    <span>${unmatched.length} state${unmatched.length > 1 ? "s" : ""} had no Figma match —</span>
    <span style="color:${V.muted}">${unmatched.map(m => {
      const s = states.find(x => x.stateId === m.stateId || x.id === m.stateId);
      return s ? esc(s.triggerDesc) : m.stateId;
    }).slice(0, 4).join(", ")}${unmatched.length > 4 ? ` +${unmatched.length - 4} more` : ""}</span>
  </div>` : ""}
</section>

<!-- L4: FOOTER ACCORDIONS -->
${hasFunctional || hasPrd ? `
<section id="checks">
  <div class="section-header">
    <h2>Checks</h2>
  </div>
  ${hasFunctional ? renderFunctionalAccordion(functional) : ""}
  ${hasPrd ? renderPrdAccordion(prdAcs, coverageGaps) : ""}
</section>` : ""}

<section id="runinfo">
  <div class="section-header">
    <h2>Run Info</h2>
  </div>
  ${renderRunInfo({ states, matches, frames, findings, warnings, aiStats, meta, now })}
</section>

</main>

<footer class="page-footer">
  QA Agent · ${esc(runId)} · ${esc(now.slice(0, 19).replace("T", " "))}
</footer>

<script>${JS}</script>
</body></html>`;
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const V = {
  bg:       "#09090B",
  surface1: "#18181B",
  surface2: "#1C1C1F",
  surface3: "#27272A",
  border:   "#27272A",
  borderMd: "#3F3F46",
  text:     "#FAFAFA",
  textSec:  "#A1A1AA",
  muted:    "#71717A",
  red:      "#F43F5E",
  amber:    "#F59E0B",
  green:    "#10B981",
  blue:     "#3B82F6",
  violet:   "#8B5CF6",
};

// ─── Dimension metadata ───────────────────────────────────────────────────────

const DIM_META = {
  layoutStructure:    { label: "Layout",       desc: "Grid, alignment, spacing, column widths" },
  typography:         { label: "Typography",   desc: "Font sizes, weights, line-heights" },
  colors:             { label: "Colors",       desc: "Background, text, accent, border colors" },
  componentStyling:   { label: "Components",   desc: "Button, input, card, table styles" },
  iconsAssets:        { label: "Icons",        desc: "Icon presence, size, and style" },
  interactionsStates: { label: "Interactions", desc: "Hover, active, disabled, empty states" },
  contentAccuracy:    { label: "Content",      desc: "Labels, placeholders, error messages" },
};

// ─── Screen cards ─────────────────────────────────────────────────────────────

function renderScreenCards(states, matches, allFindings, frames, frameAnalyses) {
  const relevant = states
    .filter(s => {
      const m = matches.find(x => x.stateId === s.id);
      return m && (m.status === "matched" || m.status === "review");
    })
    .sort((a, b) => {
      const fa = frameAnalyses.find(x => x.stateId === a.id);
      const fb = frameAnalyses.find(x => x.stateId === b.id);
      return (fa?.frameScore ?? 50) - (fb?.frameScore ?? 50);
    });

  if (!relevant.length)
    return `<p class="empty-msg">No matched frames found — check your Figma URL and page scope.</p>`;

  return relevant.map((s, idx) => renderScreenCard(s, idx, matches, allFindings, frames, frameAnalyses)).join("");
}

function renderScreenCard(s, idx, matches, allFindings, frames, frameAnalyses) {
  const m      = matches.find(x => x.stateId === s.id);
  const frame  = m?.frameId ? frames.find(f => f.id === m.frameId) : null;
  const fa     = frameAnalyses.find(x => x.stateId === s.id);
  const score  = fa?.frameScore ?? null;
  const dims   = fa?.analysis?.dimensions ?? {};

  const cardFindings = allFindings.filter(f => f.stateId === s.id);
  const cssFindings  = cardFindings.filter(f => f.category === "css" || f.category === "focused-vision");

  const sc = score;
  const borderColor = sc === null ? V.borderMd : sc >= 80 ? V.green : sc >= 60 ? V.amber : V.red;
  const scoreColor  = borderColor;
  const autoOpen    = sc !== null && sc < 80;
  const cardId      = `card-${s.id}`;

  // ── Dimension rows ──────────────────────────────────────────────────────────
  const failingDims = Object.entries(DIM_META)
    .map(([key, meta]) => ({ key, meta, d: dims[key] }))
    .filter(x => x.d && x.d.score < 80)
    .sort((a, b) => a.d.score - b.d.score);

  const passingDims = Object.entries(DIM_META)
    .map(([key, meta]) => ({ key, meta, d: dims[key] }))
    .filter(x => x.d && x.d.score >= 80);

  const dimRows = failingDims.map(({ key, meta, d }) => {
    const col = d.score >= 60 ? V.amber : V.red;
    const bg  = d.score >= 60 ? "rgba(245,158,11,.06)" : "rgba(244,63,94,.06)";
    const issues = (d.issues ?? []).slice(0, 3);
    return `
    <div class="dim-row failing" style="border-left-color:${col};background:${bg}">
      <div class="dim-row-header">
        <span class="dim-status-dot" style="background:${col}"></span>
        <span class="dim-label">${esc(meta.label)}</span>
        <span class="dim-score" style="color:${col}">${d.score}</span>
        <span class="dim-notes">${esc(d.notes ?? "")}</span>
      </div>
      ${issues.length ? `<ul class="dim-issues">
        ${issues.map(i => `<li>${esc(i)}</li>`).join("")}
      </ul>` : ""}
    </div>`;
  }).join("");

  const passingRow = passingDims.length ? `
    <div class="dim-row passing">
      ${passingDims.map(({ meta, d }) =>
        `<span class="pass-chip"><span class="pass-dot">✓</span>${esc(meta.label)} <span class="pass-score">${d.score}</span></span>`
      ).join("")}
    </div>` : "";

  const noDimsMsg = !fa ? `<div class="no-analysis">Visual analysis unavailable for this state.</div>` : "";

  // ── Screenshot toggle ────────────────────────────────────────────────────────
  const liveImg  = s.screenshot
    ? `<div><div class="ss-lbl">Live · ${esc(s.url.replace(/^https?:\/\/[^/]+/, "") || "/")}</div>
       <img src="data:image/jpeg;base64,${s.screenshot}" class="ss-img live-img" alt="live screenshot"></div>`
    : "";
  const figmaImg = m?.framePng
    ? `<div><div class="ss-lbl">Figma · ${esc(frame?.name ?? "—")} · ${(m.confidence * 100).toFixed(0)}% match</div>
       <img src="data:image/png;base64,${m.framePng}" class="ss-img figma-img" alt="figma frame"></div>`
    : `<div><div class="ss-lbl">Figma · ${frame ? esc(frame.name) : "No match"}</div>
       <div class="ss-empty">${frame ? "PNG not exported" : "No Figma frame matched"}</div></div>`;

  const ssPanel = `
    <div class="inline-panel" id="ss-${cardId}" style="display:none">
      <div class="ss-grid">${liveImg}${figmaImg}</div>
      ${s.formInteraction ? `<div class="form-badge">
        ⌨ Form filled: ${s.formInteraction.filled.map(f => `${esc(f.field)}: "${esc(f.value)}"`).join(" · ")}
        ${s.formInteraction.submitted ? `→ submitted (${esc(s.formInteraction.submitLabel)})` : "→ not submitted"}
      </div>` : ""}
    </div>`;

  // ── CSS table toggle ─────────────────────────────────────────────────────────
  const cssPanel = cssFindings.length ? `
    <div class="inline-panel" id="css-${cardId}" style="display:none">
      <table class="css-table">
        <thead><tr><th>Element</th><th>Property</th><th>Live</th><th>Figma</th><th></th></tr></thead>
        <tbody>
          ${cssFindings.map(f => {
            const rx = f.description.match(/^(.+?):\s+(.+?) is (.+?) in live,\s*(.+?) in Figma/);
            const el   = rx ? esc(rx[1]) : esc(f.description);
            const prop = rx ? esc(rx[2]) : "";
            const lv   = rx ? esc(rx[3]) : "";
            const fv   = rx ? esc(rx[4]) : "";
            const col  = f.severity === "error" ? V.red : V.amber;
            return `<tr>
              <td class="css-el">${el}</td>
              <td class="css-prop">${prop}</td>
              <td class="css-live">${lv}</td>
              <td class="css-figma">${fv}</td>
              <td><span class="sev-badge" style="color:${col}">${f.severity.toUpperCase()}</span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : "";

  // ── Card toggle buttons ──────────────────────────────────────────────────────
  const toggleBar = (s.screenshot || m?.framePng || cssFindings.length) ? `
    <div class="card-toggles">
      ${(s.screenshot || m?.framePng) ? `
        <button class="toggle-btn" onclick="togglePanel('ss-${cardId}',this)">
          Screenshots
        </button>` : ""}
      ${cssFindings.length ? `
        <button class="toggle-btn" onclick="togglePanel('css-${cardId}',this)">
          ${cssFindings.length} CSS deviation${cssFindings.length !== 1 ? "s" : ""}
        </button>` : ""}
    </div>` : "";

  return `
<div class="screen-card" id="${cardId}" style="--border-color:${borderColor}">
  <!-- Card header (always visible) -->
  <div class="card-header" onclick="toggleCard('${cardId}')">
    ${s.screenshot ? `<img src="data:image/jpeg;base64,${s.screenshot}" class="card-thumb" alt="">` : `<div class="card-thumb-empty"></div>`}
    <div class="card-meta">
      <div class="card-title">${esc(s.triggerDesc)}</div>
      ${frame ? `<div class="card-frame">↗ ${esc(frame.name)}</div>` : ""}
      ${fa?.summary ? `<div class="card-summary">${esc(fa.summary)}</div>` : ""}
    </div>
    <div class="card-right">
      <span class="match-badge ${m.status}">${m.status}</span>
      ${score !== null ? `
      <div class="score-badge" style="--sc:${scoreColor}">
        <span class="sb-num">${score}</span>
        <span class="sb-den">/100</span>
      </div>` : ""}
      <span class="card-chevron" id="chev-${cardId}">▾</span>
    </div>
  </div>

  <!-- Card body (toggle on header click) -->
  <div class="card-body" id="body-${cardId}" style="display:${autoOpen ? "block" : "none"}">
    ${noDimsMsg}
    ${dimRows}
    ${passingRow}
    ${toggleBar}
    ${ssPanel}
    ${cssPanel}
  </div>
</div>`;
}

// ─── Functional accordion ─────────────────────────────────────────────────────

function renderFunctionalAccordion(f) {
  if (!f) return "";
  const allA11y = (f.a11y ?? []).flatMap(x => x.violations.map(v => ({ ...v, url: x.url })));
  const items = [];

  for (const e of (f.consoleErrors ?? []).slice(0, 8))
    items.push({ sev: "error", cat: "Console Error", msg: e.message?.slice(0, 220) ?? "" });
  for (const e of (f.networkErrors ?? []).slice(0, 8))
    items.push({ sev: "error", cat: `Network ${e.status}`, msg: e.url?.slice(0, 180) ?? "" });
  for (const e of (f.brokenLinks ?? []).slice(0, 8))
    items.push({ sev: "error", cat: `Broken Link ${e.status}`, msg: e.href ?? "" });
  for (const v of allA11y.slice(0, 10))
    items.push({ sev: v.impact === "critical" ? "error" : "warn", cat: `A11Y · ${(v.id ?? "").toUpperCase()}`, msg: v.description ?? "" });

  const count = items.length;
  const errCount  = items.filter(i => i.sev === "error").length;
  const warnCount = items.filter(i => i.sev === "warn").length;

  return `
<div class="accordion">
  <div class="acc-header" onclick="toggleAcc(this)">
    <span class="acc-title">Functional &amp; Accessibility</span>
    <span class="acc-meta">${errCount ? `<span style="color:${V.red}">${errCount} error${errCount>1?"s":""}</span>` : ""}${warnCount ? ` · <span style="color:${V.amber}">${warnCount} warning${warnCount>1?"s":""}</span>` : ""}${!count ? `<span style="color:${V.green}">All clear</span>` : ""}</span>
    <span class="acc-chev">▾</span>
  </div>
  <div class="acc-body">
    ${count ? items.map(i => `
      <div class="finding-row ${i.sev}">
        <span class="finding-cat">${esc(i.cat)}</span>
        <span class="finding-msg">${esc(i.msg)}</span>
      </div>`).join("") : `<div class="all-clear">✓ No functional or accessibility issues found.</div>`}
  </div>
</div>`;
}

// ─── PRD accordion ────────────────────────────────────────────────────────────

function renderPrdAccordion(prdAcs, coverageGaps) {
  const passCount = (prdAcs ?? []).filter(a => a.status === "pass").length;
  const totalAcs  = (prdAcs ?? []).length;
  const gapCount  = (coverageGaps.missingScreens?.length ?? 0) + (coverageGaps.untestedActions?.length ?? 0);

  return `
<div class="accordion">
  <div class="acc-header" onclick="toggleAcc(this)">
    <span class="acc-title">PRD Coverage</span>
    <span class="acc-meta">${totalAcs ? `${passCount}/${totalAcs} criteria passed` : ""}${gapCount ? ` · <span style="color:${V.amber}">${gapCount} gap${gapCount>1?"s":""}</span>` : ""}</span>
    <span class="acc-chev">▾</span>
  </div>
  <div class="acc-body">
    ${totalAcs ? `
    <div class="sub-section-label">Acceptance Criteria</div>
    ${(prdAcs ?? []).map(a => `
      <div class="finding-row ${a.status === "pass" ? "pass" : a.status === "fail" ? "error" : "warn"}">
        <span class="finding-cat">${esc(a.id)}</span>
        <span class="finding-msg">${esc(a.text)}</span>
        <span class="status-tag ${a.status}">${a.status}</span>
      </div>`).join("")}` : ""}
    ${coverageGaps.missingScreens?.length ? `
    <div class="sub-section-label" style="margin-top:12px">Missing Screens</div>
    ${coverageGaps.missingScreens.map(s => `
      <div class="finding-row warn">
        <span class="finding-cat">Not Captured</span>
        <span class="finding-msg">${esc(s)}</span>
      </div>`).join("")}` : ""}
    ${coverageGaps.untestedActions?.length ? `
    <div class="sub-section-label" style="margin-top:12px">Untested Actions</div>
    ${coverageGaps.untestedActions.map(a => `
      <div class="finding-row warn">
        <span class="finding-cat">Not Triggered</span>
        <span class="finding-msg">${esc(a)}</span>
      </div>`).join("")}` : ""}
  </div>
</div>`;
}

// ─── Run info accordion ───────────────────────────────────────────────────────

function renderRunInfo({ states, matches, frames, findings, warnings, aiStats, meta, now }) {
  const stateRows = states.map(s => {
    const m = matches.find(x => x.stateId === s.id);
    const col = m?.status === "matched" ? V.green : m?.status === "review" ? V.amber : V.muted;
    return `<tr>
      <td style="color:${V.textSec};font-family:monospace;font-size:11px">${esc(s.id)}</td>
      <td>${esc(s.triggerDesc)}</td>
      <td><span class="status-tag ${m?.status ?? "unmatched"}">${m?.status ?? "unmatched"}</span></td>
      <td style="color:${V.textSec}">${m?.frameName ? esc(m.frameName) : "—"}</td>
      <td style="color:${V.textSec};text-align:right">${m ? (m.confidence * 100).toFixed(0) + "%" : "—"}</td>
    </tr>`;
  }).join("");

  return `
<div class="accordion">
  <div class="acc-header" onclick="toggleAcc(this)">
    <span class="acc-title">State Map</span>
    <span class="acc-meta">${states.length} states explored</span>
    <span class="acc-chev">▾</span>
  </div>
  <div class="acc-body">
    <table class="run-table">
      <thead><tr><th>ID</th><th>Trigger</th><th>Status</th><th>Figma Frame</th><th style="text-align:right">Confidence</th></tr></thead>
      <tbody>${stateRows}</tbody>
    </table>
  </div>
</div>
<div class="accordion">
  <div class="acc-header" onclick="toggleAcc(this)">
    <span class="acc-title">Run Metadata</span>
    <span class="acc-meta">${aiStats ? `$${(aiStats.cost ?? 0).toFixed(3)} · ${(aiStats.textCalls ?? 0) + (aiStats.visionCalls ?? 0)} AI calls` : ""}</span>
    <span class="acc-chev">▾</span>
  </div>
  <div class="acc-body">
    <div class="meta-grid">
      <div class="meta-item"><div class="meta-lbl">Live URL</div><div class="meta-val">${esc(meta.liveUrl)}</div></div>
      <div class="meta-item"><div class="meta-lbl">Figma File</div><div class="meta-val">${esc(meta.figmaFileKey ?? "—")}</div></div>
      <div class="meta-item"><div class="meta-lbl">Generated</div><div class="meta-val">${esc(now.slice(0, 19).replace("T", " "))} UTC</div></div>
      <div class="meta-item"><div class="meta-lbl">Run ID</div><div class="meta-val" style="font-family:monospace">${esc(meta.runId ?? "")}</div></div>
      ${aiStats ? `
      <div class="meta-item"><div class="meta-lbl">Text calls</div><div class="meta-val">${aiStats.textCalls ?? 0}</div></div>
      <div class="meta-item"><div class="meta-lbl">Vision calls</div><div class="meta-val">${aiStats.visionCalls ?? 0}</div></div>
      <div class="meta-item"><div class="meta-lbl">Cache hits</div><div class="meta-val">${aiStats.cacheHits ?? 0}</div></div>
      <div class="meta-item"><div class="meta-lbl">Est. cost</div><div class="meta-val">$${(aiStats.cost ?? 0).toFixed(3)}</div></div>` : ""}
    </div>
    ${warnings.length ? `
    <div class="sub-section-label" style="margin-top:16px">Warnings</div>
    ${warnings.map(w => `<div class="finding-row warn"><span class="finding-cat">${esc(w.step)}</span><span class="finding-msg">${esc(w.message.slice(0, 180))}</span></div>`).join("")}` : ""}
  </div>
</div>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #09090B;
    --s1:       #18181B;
    --s2:       #1C1C1F;
    --border:   #27272A;
    --border-md:#3F3F46;
    --text:     #FAFAFA;
    --text-sec: #A1A1AA;
    --muted:    #71717A;
    --red:      #F43F5E;
    --amber:    #F59E0B;
    --green:    #10B981;
    --blue:     #3B82F6;
    --violet:   #8B5CF6;
    --radius:   10px;
    --radius-sm:6px;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.5; font-size: 14px;
  }

  /* NAV */
  #topnav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(9,9,11,.92); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .nav-inner {
    max-width: 1120px; margin: 0 auto; padding: 0 24px;
    display: flex; align-items: center; gap: 24px; height: 48px;
  }
  .nav-brand { font-size: 13px; font-weight: 700; color: var(--text); letter-spacing: -.01em; flex-shrink:0; }
  .nav-links { display: flex; gap: 4px; }
  .nav-links a {
    font-size: 13px; font-weight: 500; color: var(--text-sec); text-decoration: none;
    padding: 5px 10px; border-radius: var(--radius-sm); transition: color .15s, background .15s;
  }
  .nav-links a:hover, .nav-links a.active { color: var(--text); background: var(--s1); }
  .nav-run { margin-left: auto; font-size: 11px; font-family: monospace; color: var(--muted); }

  /* LAYOUT */
  main { max-width: 1120px; margin: 0 auto; padding: 24px 24px 48px; }

  /* WARN BANNER */
  .warn-banner {
    display: flex; gap: 10px; align-items: flex-start;
    background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.2);
    border-radius: var(--radius); padding: 12px 16px; margin-bottom: 20px; font-size: 13px; color: #FCD34D;
  }
  .warn-icon { flex-shrink: 0; }

  /* HERO BAND */
  .hero-band {
    display: flex; gap: 28px; align-items: flex-start;
    background: linear-gradient(135deg, #111116 0%, #18181B 100%);
    border: 1px solid var(--border); border-radius: 14px;
    padding: 28px 32px; margin-bottom: 28px;
  }
  .hero-left { display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0; }
  .score-ring {
    width: 80px; height: 80px; border-radius: 50%;
    border: 3px solid var(--sc, var(--muted));
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(0,0,0,.3);
  }
  .score-num  { font-size: 26px; font-weight: 800; color: var(--sc, var(--muted)); line-height: 1; }
  .score-denom { font-size: 10px; color: var(--muted); }
  .score-verdict { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .hero-right { flex: 1; min-width: 0; }
  .hero-title { font-size: 20px; font-weight: 800; letter-spacing: -.02em; margin-bottom: 4px; }
  .hero-meta  { font-size: 12px; color: var(--text-sec); margin-bottom: 16px; }
  .hero-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .stat-pill {
    display: flex; align-items: baseline; gap: 5px;
    background: var(--s2); border: 1px solid var(--border);
    border-radius: 999px; padding: 4px 12px;
  }
  .stat-pill.red   { background: rgba(244,63,94,.08);  border-color: rgba(244,63,94,.25); }
  .stat-pill.amber { background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.25); }
  .stat-pill.muted { opacity: .7; }
  .stat-val { font-size: 14px; font-weight: 700; }
  .stat-lbl { font-size: 11px; color: var(--text-sec); }
  .dim-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .dim-chip {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 600; padding: 3px 10px;
    border: 1px solid; border-radius: 999px; cursor: default;
    letter-spacing: .01em;
  }
  .dim-chip-icon { font-size: 10px; }
  .dim-chip-score { opacity: .7; }

  /* SECTION HEADER */
  section { margin-bottom: 32px; }
  .section-header {
    display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px;
  }
  .section-header h2 { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
  .section-sub { font-size: 12px; color: var(--muted); }

  /* SCREEN CARD */
  .screen-card {
    border: 1px solid var(--border); border-left: 3px solid var(--border-color, var(--border));
    border-radius: var(--radius); background: var(--s1);
    margin-bottom: 10px; overflow: hidden;
    transition: border-color .2s;
  }
  .screen-card:hover { border-color: var(--border-md); border-left-color: var(--border-color, var(--border-md)); }

  .card-header {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 16px; cursor: pointer; user-select: none;
  }
  .card-header:hover { background: rgba(255,255,255,.02); }
  .card-thumb {
    width: 96px; height: 60px; object-fit: cover; object-position: top;
    border-radius: 5px; flex-shrink: 0; border: 1px solid var(--border);
  }
  .card-thumb-empty {
    width: 96px; height: 60px; border-radius: 5px; flex-shrink: 0;
    border: 1px dashed var(--border); background: var(--s2);
  }
  .card-meta { flex: 1; min-width: 0; }
  .card-title { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-frame { font-size: 11px; color: var(--text-sec); margin-top: 2px; }
  .card-summary { font-size: 11px; color: var(--text-sec); margin-top: 5px; line-height: 1.5;
                  border-left: 2px solid var(--blue); padding-left: 7px; }
  .card-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .match-badge {
    font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    padding: 2px 8px; border-radius: 999px;
  }
  .match-badge.matched  { background: rgba(16,185,129,.12); color: #34D399; border: 1px solid rgba(16,185,129,.25); }
  .match-badge.review   { background: rgba(245,158,11,.12); color: #FCD34D; border: 1px solid rgba(245,158,11,.25); }
  .match-badge.unmatched{ background: rgba(244,63,94,.12);  color: #FDA4AF; border: 1px solid rgba(244,63,94,.25); }
  .score-badge {
    display: flex; align-items: baseline; gap: 1px;
    border: 2px solid var(--sc, var(--muted));
    border-radius: 8px; padding: 3px 8px;
  }
  .sb-num  { font-size: 15px; font-weight: 800; color: var(--sc, var(--muted)); }
  .sb-den  { font-size: 9px; color: var(--muted); }
  .card-chevron { font-size: 13px; color: var(--muted); transition: transform .2s; }
  .card-chevron.open { transform: rotate(180deg); }

  /* CARD BODY */
  .card-body { border-top: 1px solid var(--border); padding: 0 16px 14px; }

  /* DIMENSION ROWS */
  .dim-row {
    display: flex; flex-direction: column;
    border-left: 2px solid transparent; border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    margin: 10px 0; padding: 8px 10px;
  }
  .dim-row.failing { }
  .dim-row-header {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .dim-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .dim-label { font-size: 12px; font-weight: 700; color: var(--text); }
  .dim-score { font-size: 12px; font-weight: 700; }
  .dim-notes { font-size: 12px; color: var(--text-sec); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dim-issues { list-style: none; margin-top: 6px; padding-left: 14px; }
  .dim-issues li {
    font-size: 12px; color: var(--text-sec); padding: 2px 0;
    border-left: 1px solid var(--border); padding-left: 10px; margin-bottom: 2px;
  }
  .dim-issues li::before { content: "·  "; color: var(--muted); }

  /* PASSING ROW */
  .dim-row.passing {
    display: flex; flex-direction: row; flex-wrap: wrap; gap: 6px;
    margin-top: 10px; padding: 8px 0; border-left: none;
    border-top: 1px solid var(--border);
  }
  .pass-chip {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; color: var(--text-sec);
    background: rgba(16,185,129,.06); border: 1px solid rgba(16,185,129,.15);
    border-radius: 999px; padding: 2px 10px;
  }
  .pass-dot { color: var(--green); font-size: 10px; }
  .pass-score { color: var(--green); font-weight: 700; }

  /* NO ANALYSIS */
  .no-analysis { font-size: 12px; color: var(--muted); padding: 12px 0; }

  /* CARD TOGGLES */
  .card-toggles { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
  .toggle-btn {
    font-size: 11px; font-weight: 600; color: var(--text-sec);
    background: var(--s2); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 4px 12px; cursor: pointer;
    transition: color .15s, border-color .15s, background .15s;
  }
  .toggle-btn:hover, .toggle-btn.active {
    color: var(--text); border-color: var(--border-md); background: var(--s2);
  }

  /* INLINE PANELS */
  .inline-panel { margin-top: 12px; }
  .ss-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .ss-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
  .ss-img { width: 100%; border-radius: 6px; display: block; border: 1px solid var(--border); }
  .live-img  { border-color: rgba(59,130,246,.4); }
  .figma-img { border-color: rgba(16,185,129,.4); background: #fff; }
  .ss-empty  { display: flex; align-items: center; justify-content: center; height: 120px; border: 1px dashed var(--border); border-radius: 6px; color: var(--muted); font-size: 12px; }
  .form-badge {
    margin-top: 8px; font-size: 11px; color: #6EE7B7;
    background: rgba(16,185,129,.08); border: 1px solid rgba(16,185,129,.2);
    border-radius: var(--radius-sm); padding: 6px 10px;
  }

  /* CSS TABLE */
  .css-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .css-table th { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; font-weight: 500; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
  .css-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .css-table tr:last-child td { border-bottom: none; }
  .css-el   { font-weight: 600; color: var(--text); }
  .css-prop { font-family: monospace; color: var(--text-sec); }
  .css-live { font-family: monospace; color: #93C5FD; }
  .css-figma{ font-family: monospace; color: #6EE7B7; }
  .sev-badge { font-size: 10px; font-weight: 700; letter-spacing: .04em; }

  /* UNMATCHED NOTE */
  .unmatched-note {
    font-size: 12px; color: var(--muted); padding: 10px 14px;
    border: 1px dashed var(--border); border-radius: var(--radius-sm); margin-top: 8px;
    display: flex; gap: 6px; flex-wrap: wrap;
  }

  /* EMPTY */
  .empty-msg { font-size: 13px; color: var(--muted); padding: 20px 0; }

  /* ACCORDION */
  .accordion {
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--s1); margin-bottom: 8px; overflow: hidden;
  }
  .acc-header {
    display: flex; align-items: center; gap: 12px;
    padding: 13px 18px; cursor: pointer; user-select: none;
  }
  .acc-header:hover { background: rgba(255,255,255,.02); }
  .acc-title { font-size: 13px; font-weight: 700; }
  .acc-meta  { font-size: 12px; color: var(--text-sec); flex: 1; }
  .acc-chev  { font-size: 12px; color: var(--muted); transition: transform .2s; }
  .acc-chev.open { transform: rotate(180deg); }
  .acc-body  { display: none; padding: 0 18px 16px; border-top: 1px solid var(--border); padding-top: 14px; }
  .acc-body.open { display: block; }

  /* FINDING ROW */
  .finding-row {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
    padding: 7px 10px; border-radius: var(--radius-sm); margin-bottom: 4px; font-size: 12px;
  }
  .finding-row.error { background: rgba(244,63,94,.07);  border-left: 2px solid var(--red); }
  .finding-row.warn  { background: rgba(245,158,11,.07); border-left: 2px solid var(--amber); }
  .finding-row.pass  { background: rgba(16,185,129,.06); border-left: 2px solid var(--green); }
  .finding-cat { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-sec); white-space: nowrap; flex-shrink:0; }
  .finding-msg { color: var(--text); flex: 1; }
  .all-clear { font-size: 13px; color: var(--green); padding: 4px 0; }

  /* STATUS TAGS */
  .status-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 999px; }
  .status-tag.matched, .status-tag.pass    { background: rgba(16,185,129,.12); color: #34D399; }
  .status-tag.review,  .status-tag.partial { background: rgba(245,158,11,.12); color: #FCD34D; }
  .status-tag.unmatched,.status-tag.fail   { background: rgba(244,63,94,.12);  color: #FDA4AF; }

  /* SUB SECTION LABEL */
  .sub-section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 8px; }

  /* RUN TABLE */
  .run-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .run-table th { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; font-weight: 500; color: var(--muted); padding: 5px 8px; border-bottom: 1px solid var(--border); text-align: left; }
  .run-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--text); }
  .run-table tr:last-child td { border-bottom: none; }

  /* META GRID */
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
  .meta-item { background: var(--s2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; }
  .meta-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 4px; }
  .meta-val { font-size: 13px; font-weight: 600; color: var(--text); word-break: break-all; }

  /* FOOTER */
  .page-footer { text-align: center; font-size: 11px; color: var(--muted); padding: 20px 24px 32px; }
`;

// ─── JS ───────────────────────────────────────────────────────────────────────

const JS = `
  // Card toggle
  function toggleCard(id) {
    const body = document.getElementById('body-' + id);
    const chev = document.getElementById('chev-' + id);
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (chev) chev.classList.toggle('open', !open);
  }

  // Inline panel toggle (screenshots / CSS)
  function togglePanel(id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    btn.classList.toggle('active', !open);
  }

  // Accordion toggle
  function toggleAcc(header) {
    const body = header.nextElementSibling;
    const chev = header.querySelector('.acc-chev');
    if (!body) return;
    const open = body.classList.contains('open');
    body.classList.toggle('open', !open);
    if (chev) chev.classList.toggle('open', !open);
  }

  // Nav active link on scroll
  const navLinks = document.querySelectorAll('.nav-links a');
  const sections = document.querySelectorAll('section[id], .hero-band[id]');
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
      }
    });
  }, { rootMargin: '-30% 0px -65% 0px' });
  sections.forEach(s => io.observe(s));
`;

// ─── Utility ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
