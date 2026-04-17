export function generateReport({
  runId, meta, frames, states, matches, findings, frameAnalyses = [],
  functional, prdAcs, coverageGaps = { missingScreens: [], untestedActions: [] },
  aiStats, warnings = [],
}) {
  const score = computeScore(findings, matches, functional);
  const now   = new Date().toISOString();

  const matched   = matches.filter((m) => m.status === "matched");
  const review    = matches.filter((m) => m.status === "review");
  const unmatched = matches.filter((m) => m.status === "unmatched");

  const hasIssues   = findings.length > 0;
  const hasChecks   = functional && (
    (functional.consoleErrors?.length ?? 0) +
    (functional.networkErrors?.length  ?? 0) +
    (functional.brokenLinks?.length    ?? 0) +
    (functional.a11y?.flatMap(x => x.violations)?.length ?? 0)
  ) > 0;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Report · ${escapeHtml(runId)}</title>
<style>
  :root {
    --bg:#0b0f1a; --panel:#111827; --panel2:#1a2235; --border:#1e2640;
    --text:#e2e8f0; --muted:#94a3b8; --dim:#64748b;
    --blue:#3b82f6; --green:#22c55e; --yellow:#eab308; --red:#ef4444;
  }
  *{box-sizing:border-box;}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
       background:var(--bg);color:var(--text);line-height:1.5;}
  .wrap{max-width:1140px;margin:0 auto;padding:20px 24px;}

  /* Nav */
  #nav{position:sticky;top:0;z-index:100;background:rgba(11,15,26,.96);backdrop-filter:blur(8px);
       border-bottom:1px solid var(--border);display:flex;gap:2px;padding:6px 24px;overflow-x:auto;}
  #nav a{color:var(--muted);font-size:12px;font-weight:600;text-decoration:none;padding:5px 12px;
         border-radius:6px;white-space:nowrap;}
  #nav a:hover,#nav a.on{background:var(--panel);color:var(--text);}

  /* Hero */
  .hero{background:linear-gradient(135deg,#1a2550,#111827);border:1px solid var(--border);
        border-radius:14px;padding:24px 28px;margin-bottom:18px;display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap;}
  .hero-score{flex-shrink:0;text-align:center;}
  .big-score{font-size:68px;font-weight:900;line-height:1;}
  .score-label{font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.08em;}
  .verdict{font-size:13px;font-weight:600;margin-top:6px;}
  .hero-body{flex:1;min-width:240px;}
  .hero-title{font-size:22px;font-weight:800;margin:0 0 4px;}
  .hero-sub{color:var(--muted);font-size:12px;margin-bottom:12px;}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
  .chip{padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;}
  .chip.e{background:rgba(239,68,68,.15);color:#fca5a5;}
  .chip.w{background:rgba(234,179,8,.15);color:#fde68a;}
  .chip.i{background:rgba(59,130,246,.15);color:#93c5fd;}
  .chip.g{background:rgba(34,197,94,.15);color:#86efac;}
  .hero-explain{font-size:13px;color:#94a3b8;line-height:1.6;}

  /* Section */
  section{background:var(--panel);border:1px solid var(--border);border-radius:12px;
          padding:0;margin-bottom:14px;overflow:hidden;}
  .sec-hd{padding:14px 20px;display:flex;justify-content:space-between;align-items:center;
          cursor:pointer;user-select:none;border-bottom:1px solid var(--border);}
  .sec-hd:hover{background:#141e30;}
  .sec-hd h2{margin:0;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px;}
  .sec-hd .aud{font-size:11px;background:var(--panel2);padding:2px 8px;border-radius:6px;
               color:var(--muted);font-weight:500;}
  .sec-hd .tog{color:var(--muted);font-size:14px;transition:transform .2s;flex-shrink:0;}
  .sec-body{padding:16px 20px;}
  section.shut .sec-body{display:none;}
  section.shut .tog{transform:rotate(-90deg);}

  /* Frame card */
  .fc{border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden;background:var(--panel2);}
  .fc-hd{padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;
         cursor:pointer;user-select:none;}
  .fc-hd:hover{background:#1f2d45;}
  .fc.open .fc-hd{border-bottom:1px solid var(--border);}
  .fc-body{display:none;padding:14px 16px;}
  .fc.open .fc-body{display:block;}
  .chev{color:var(--muted);font-size:13px;transition:transform .2s;flex-shrink:0;}
  .fc.open .chev{transform:rotate(90deg);}

  /* Score ring */
  .ring{width:52px;height:52px;border-radius:50%;display:flex;flex-direction:column;align-items:center;
        justify-content:center;font-weight:900;font-size:16px;border:3px solid;flex-shrink:0;}
  .ring small{font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;}

  /* Tabs */
  .tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin:-14px -16px 14px;}
  .tb{padding:8px 16px;font-size:12px;font-weight:600;border:none;background:none;
      color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;}
  .tb.on{color:var(--blue);border-bottom-color:var(--blue);}
  .tp{display:none;}
  .tp.on{display:block;}

  /* Screenshots */
  .ss-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .ss-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;
            font-weight:600;margin-bottom:5px;}
  .ss-grid img{width:100%;border-radius:7px;display:block;}
  .ss-empty{display:flex;align-items:center;justify-content:center;height:160px;
            border:2px dashed var(--border);border-radius:7px;color:var(--dim);font-size:12px;text-align:center;padding:12px;}

  /* Dimension pills */
  .dim-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;}
  .dp{padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid;}

  /* Finding */
  .finding{border-radius:6px;padding:9px 12px;margin-bottom:6px;border-left:3px solid;}
  .finding.error{background:rgba(239,68,68,.07);border-left-color:var(--red);}
  .finding.warn{background:rgba(234,179,8,.07);border-left-color:var(--yellow);}
  .finding.info{background:rgba(59,130,246,.07);border-left-color:var(--blue);}
  .f-head{font-size:11px;color:var(--muted);margin-bottom:3px;}
  .f-desc{font-size:13px;}

  /* Table */
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th,td{padding:7px 10px;text-align:left;border-bottom:1px solid var(--border);}
  th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:500;}

  .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;}
  .pill.matched{background:rgba(34,197,94,.15);color:#86efac;}
  .pill.review{background:rgba(234,179,8,.15);color:#fde68a;}
  .pill.unmatched{background:rgba(239,68,68,.15);color:#fca5a5;}
  .pill.pass{background:rgba(34,197,94,.15);color:#86efac;}
  .pill.fail{background:rgba(239,68,68,.15);color:#fca5a5;}
  .pill.partial{background:rgba(234,179,8,.15);color:#fde68a;}

  footer{color:var(--dim);font-size:12px;text-align:center;padding:14px;}
</style>
</head><body>

<nav id="nav">
  <a href="#frames">Frames</a>
  ${hasIssues  ? `<a href="#issues">Issues</a>`  : ""}
  ${hasChecks  ? `<a href="#checks">Checks</a>`  : ""}
  <a href="#debug">Debug</a>
</nav>

<div class="wrap">

${warnings.length ? `
<div style="background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.3);border-radius:10px;
            padding:12px 16px;margin-bottom:14px;font-size:13px;color:#fcd34d;">
  ⚠ ${warnings.map(w => `<strong>${escapeHtml(w.step)}:</strong> ${escapeHtml(w.message.slice(0,160))}`).join(" · ")}
</div>` : ""}

<!-- HERO -->
<div class="hero">
  <div class="hero-score">
    <div class="big-score" style="color:${scoreColor(score.value)}">${score.value}</div>
    <div class="score-label">/ 100</div>
    <div class="verdict" style="color:${scoreColor(score.value)}">
      ${score.noData ? "No data" : score.value >= 85 ? "✓ Solid" : score.value >= 65 ? "△ Needs review" : "✗ Significant gaps"}
    </div>
  </div>
  <div class="hero-body">
    <div class="hero-title">Frontend QA Report</div>
    <div class="hero-sub">${escapeHtml(meta.liveUrl)} · ${escapeHtml(now.slice(0,16).replace("T"," "))}</div>
    <div class="chips">
      ${score.errors ? `<span class="chip e">${score.errors} error${score.errors>1?"s":""}</span>` : ""}
      ${score.warns  ? `<span class="chip w">${score.warns} warning${score.warns>1?"s":""}</span>`  : ""}
      <span class="chip g">${matched.length} matched</span>
      ${review.length    ? `<span class="chip w">${review.length} review</span>`    : ""}
      ${unmatched.length ? `<span class="chip i">${unmatched.length} unmatched</span>` : ""}
      <span class="chip i">${states.length} states explored</span>
    </div>
    <div class="hero-explain">${scoreExplanation(score, states.length, matched.length, unmatched.length, frameAnalyses)}</div>
  </div>
</div>

<!-- SECTION 1: FRAME COMPARISONS -->
<section id="frames">
  <div class="sec-hd">
    <h2>Frame Comparisons <span class="aud">Designer / QA</span></h2>
    <span class="tog">▾</span>
  </div>
  <div class="sec-body">
    ${renderFrameCards(states, matches, findings, frames, frameAnalyses)}
    ${unmatched.length ? `
    <details style="margin-top:8px;">
      <summary style="cursor:pointer;font-size:12px;color:var(--muted);padding:6px 0;">
        ${unmatched.length} state${unmatched.length>1?"s":""} had no Figma match
      </summary>
      <div style="font-size:12px;color:var(--dim);margin-top:6px;padding-left:12px;line-height:1.8;">
        ${unmatched.map(m => {
          const s = states.find(x => x.id === m.stateId);
          return escapeHtml(s ? `${s.id} — ${s.triggerDesc}` : m.stateId);
        }).join("<br>")}
      </div>
    </details>` : ""}
  </div>
</section>

<!-- SECTION 2: ALL ISSUES (only if there are findings) -->
${hasIssues ? `
<section id="issues" class="shut">
  <div class="sec-hd">
    <h2>Issues <span class="aud">QA / Designer</span>
      <span style="font-size:12px;font-weight:400;color:var(--muted);">&nbsp;${score.errors} error${score.errors!==1?"s":""} · ${score.warns} warning${score.warns!==1?"s":""}</span>
    </h2>
    <span class="tog">▾</span>
  </div>
  <div class="sec-body">${renderAllIssues(findings, states)}</div>
</section>` : ""}

<!-- SECTION 3: FUNCTIONAL + A11Y CHECKS -->
${hasChecks ? `
<section id="checks" class="shut">
  <div class="sec-hd">
    <h2>Functional &amp; Accessibility Checks <span class="aud">QA</span></h2>
    <span class="tog">▾</span>
  </div>
  <div class="sec-body">${renderChecks(functional)}</div>
</section>` : ""}

<!-- SECTION 4: DEBUG -->
<section id="debug" class="shut">
  <div class="sec-hd">
    <h2>Debug &amp; Metadata</h2>
    <span class="tog">▾</span>
  </div>
  <div class="sec-body">
    ${renderDebug({ states, matches, prdAcs, coverageGaps, meta, aiStats, now })}
  </div>
</section>

</div>
<footer>QA Agent · ${escapeHtml(runId)} · ${escapeHtml(now)}</footer>

<script>
  // Section toggle
  document.querySelectorAll(".sec-hd").forEach(h =>
    h.addEventListener("click", () => h.closest("section").classList.toggle("shut"))
  );
  // Frame card accordion
  document.querySelectorAll(".fc-hd").forEach(h =>
    h.addEventListener("click", () => h.closest(".fc").classList.toggle("open"))
  );
  // Tabs
  document.querySelectorAll(".tb").forEach(btn =>
    btn.addEventListener("click", () => {
      const body = btn.closest(".fc-body");
      body.querySelectorAll(".tb").forEach(b => b.classList.remove("on"));
      body.querySelectorAll(".tp").forEach(p => p.classList.remove("on"));
      btn.classList.add("on");
      body.querySelector("[data-t='" + btn.dataset.t + "']").classList.add("on");
    })
  );
  // Nav highlight
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting)
        document.querySelectorAll("#nav a").forEach(a =>
          a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id)
        );
    });
  }, { rootMargin:"-40% 0px -55% 0px" });
  document.querySelectorAll("section[id]").forEach(s => obs.observe(s));
</script>
</body></html>`;
}

// ─── Frame cards ─────────────────────────────────────────────────────────────

const DIM_META = {
  layoutStructure:    "Layout",
  typography:         "Typography",
  colors:             "Colors",
  componentStyling:   "Components",
  iconsAssets:        "Icons",
  interactionsStates: "Interactions",
  contentAccuracy:    "Content",
};

function renderFrameCards(states, matches, allFindings, frames, frameAnalyses) {
  // Only show matched + review states as full cards
  const relevant = states.filter(s => {
    const m = matches.find(x => x.stateId === s.id);
    return m && (m.status === "matched" || m.status === "review");
  });
  if (!relevant.length) return `<p style="color:var(--muted);font-size:13px">No matched frames — check Figma URL and page scope.</p>`;

  return relevant.map(s => {
    const m        = matches.find(x => x.stateId === s.id);
    const frame    = m?.frameId ? frames.find(f => f.id === m.frameId) : null;
    const findings = allFindings.filter(f => f.stateId === s.id);
    const errs     = findings.filter(f => f.severity === "error").length;
    const warns    = findings.filter(f => f.severity === "warn").length;
    const fa       = frameAnalyses.find(x => x.stateId === s.id);
    const score    = fa?.frameScore ?? null;
    const rc       = score === null ? "#64748b" : score >= 75 ? "#22c55e" : score >= 50 ? "#eab308" : "#ef4444";

    // Score ring
    const ring = score !== null ? `
      <div class="ring" style="border-color:${rc};color:${rc}">
        ${score}<small>/100</small>
      </div>` : "";

    // Summary (1-line AI verdict)
    const summary = fa?.summary
      ? `<div style="font-size:11px;color:#cbd5e1;margin-top:4px;border-left:2px solid #3b82f6;padding-left:7px;line-height:1.5">${escapeHtml(fa.summary)}</div>`
      : "";

    // TAB 1 — Screenshots
    const liveImg = s.screenshot ? `
      <div>
        <div class="ss-label">Live · ${escapeHtml(s.url.replace(/^https?:\/\/[^/]+/, ""))}</div>
        <img src="data:image/png;base64,${s.screenshot}" style="border:2px solid #3b82f6;" alt="live">
      </div>` : "";

    const figmaImg = m?.framePng ? `
      <div>
        <div class="ss-label">Figma · ${escapeHtml(frame?.name ?? "—")} (${(m.confidence*100).toFixed(0)}% match)</div>
        <img src="data:image/png;base64,${m.framePng}" style="border:2px solid #22c55e;background:#fff;" alt="figma">
      </div>` : `
      <div>
        <div class="ss-label">Figma · ${frame ? escapeHtml(frame.name) + " — PNG pending" : "No match"}</div>
        <div class="ss-empty">${frame ? "Figma PNG not exported (API rate limit or first run)" : "No Figma frame matched this state"}</div>
      </div>`;

    // TAB 2 — Dimensions (compact pills + note for worst dim)
    const dims      = fa?.analysis?.dimensions ?? {};
    const dimPills  = Object.entries(DIM_META).map(([key, label]) => {
      const d  = dims[key];
      const sc = d?.score ?? 0;
      const c  = sc >= 75 ? "#22c55e" : sc >= 50 ? "#eab308" : "#ef4444";
      const bc = sc >= 75 ? "rgba(34,197,94,.25)" : sc >= 50 ? "rgba(234,179,8,.25)" : "rgba(239,68,68,.25)";
      return `<span class="dp" style="color:${c};background:${bc};border-color:${c}">${label} ${d ? sc : "—"}</span>`;
    }).join("");

    const worstDims = Object.entries(DIM_META)
      .map(([key, label]) => ({ key, label, d: dims[key] }))
      .filter(x => x.d && x.d.score < 70 && x.d.notes && x.d.notes !== "—")
      .sort((a,b) => a.d.score - b.d.score)
      .slice(0, 2);

    const dimDetail = worstDims.map(({ label, d }) => {
      const c = d.score >= 50 ? "#eab308" : "#ef4444";
      return `<div style="margin-top:10px;padding:8px 10px;background:rgba(0,0,0,.2);border-radius:6px;border-left:2px solid ${c}">
        <span style="font-size:11px;font-weight:700;color:${c}">${escapeHtml(label)} · ${d.score}/100</span>
        <div style="font-size:12px;color:#cbd5e1;margin-top:3px;line-height:1.5">${escapeHtml(d.notes)}</div>
        ${(d.issues??[]).slice(0,3).map(i=>`<div style="font-size:11px;color:var(--muted);padding-top:3px;">· ${escapeHtml(i)}</div>`).join("")}
      </div>`;
    }).join("");

    const tabDimensions = fa ? `<div class="dim-row">${dimPills}</div>${dimDetail}` :
      `<p style="color:var(--muted);font-size:13px">No analysis available.</p>`;

    // TAB 3 — Issues (top 5 only, link to full Issues section for more)
    const topFindings = findings.slice(0, 5);
    const tabIssues = topFindings.length ? `
      ${topFindings.map(f => `
        <div class="finding ${f.severity}">
          <div class="f-head">${escapeHtml((f.category||"general").toUpperCase())} · ${f.severity}</div>
          <div class="f-desc">${escapeHtml(f.description)}</div>
        </div>`).join("")}
      ${findings.length > 5 ? `<a href="#issues" style="font-size:12px;color:var(--blue);">+ ${findings.length-5} more in Issues section</a>` : ""}` :
      `<p style="color:var(--muted);font-size:13px;margin:0">No issues detected for this frame.</p>`;

    return `
    <div class="fc">
      <div class="fc-hd">
        <div style="min-width:0;flex:1">
          <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${escapeHtml(s.triggerDesc)}
          </div>
          ${frame ? `<div style="font-size:11px;color:var(--muted);margin-top:1px">→ ${escapeHtml(frame.name)}</div>` : ""}
          ${summary}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;margin-left:12px">
          <span class="pill ${m.status}">${m.status}</span>
          ${errs  ? `<span class="chip e" style="padding:2px 8px;font-size:11px">${errs}E</span>` : ""}
          ${warns ? `<span class="chip w" style="padding:2px 8px;font-size:11px">${warns}W</span>` : ""}
          ${!errs&&!warns&&frame ? `<span style="font-size:12px;color:var(--green)">✓</span>` : ""}
          ${ring}
          <span class="chev">▶</span>
        </div>
      </div>
      <div class="fc-body">
        <div class="tabs">
          <button class="tb on" data-t="ss">Screenshots</button>
          <button class="tb" data-t="dim">Dimensions</button>
          <button class="tb" data-t="iss">Issues${errs+warns>0?` (${errs+warns})`:""}</button>
        </div>
        <div class="tp on" data-t="ss"><div class="ss-grid">${liveImg}${figmaImg}</div></div>
        <div class="tp" data-t="dim">${tabDimensions}</div>
        <div class="tp" data-t="iss">${tabIssues}</div>
      </div>
    </div>`;
  }).join("");
}

// ─── All Issues (flat list, sorted by severity) ───────────────────────────────

function renderAllIssues(findings, states) {
  const sorted = [...findings].sort((a,b) => {
    const sev = { error:0, warn:1, info:2 };
    return (sev[a.severity]??2) - (sev[b.severity]??2);
  });
  return sorted.map(f => {
    const s = states.find(x => x.id === f.stateId);
    return `
      <div class="finding ${f.severity}">
        <div class="f-head">${escapeHtml((f.category||"general").toUpperCase())} · ${f.severity}
          ${s ? ` · <span style="color:var(--dim)">${escapeHtml(s.triggerDesc)}</span>` : ""}
        </div>
        <div class="f-desc">${escapeHtml(f.description)}</div>
        ${f.evidence ? `<div style="color:var(--muted);font-size:11px;margin-top:3px">${escapeHtml(String(f.evidence))}</div>` : ""}
      </div>`;
  }).join("");
}

// ─── Functional + A11y checks ─────────────────────────────────────────────────

function renderChecks(f) {
  if (!f) return `<p style="color:var(--muted)">Not run.</p>`;
  const blocks = [];

  const allA11y = (f.a11y ?? []).flatMap(x => x.violations.map(v => ({ ...v, url: x.url })));

  if (f.consoleErrors?.length)
    blocks.push(...f.consoleErrors.slice(0,6).map(e =>
      `<div class="finding error"><div class="f-head">CONSOLE ERROR</div><div class="f-desc">${escapeHtml(e.message?.slice(0,200))}</div></div>`));

  if (f.networkErrors?.length)
    blocks.push(...f.networkErrors.slice(0,6).map(e =>
      `<div class="finding error"><div class="f-head">NETWORK ${e.status}</div><div class="f-desc">${escapeHtml(e.url?.slice(0,140))}</div></div>`));

  if (f.brokenLinks?.length)
    blocks.push(...f.brokenLinks.slice(0,6).map(e =>
      `<div class="finding error"><div class="f-head">BROKEN LINK ${e.status}</div><div class="f-desc">${escapeHtml(e.href)}</div></div>`));

  if (allA11y.length)
    blocks.push(...allA11y.slice(0,8).map(v =>
      `<div class="finding ${v.impact==="critical"?"error":"warn"}">
        <div class="f-head">A11Y · ${v.impact?.toUpperCase()} · ${escapeHtml(v.id)}</div>
        <div class="f-desc">${escapeHtml(v.description)}</div>
      </div>`));

  return blocks.length ? blocks.join("") :
    `<p style="color:var(--green);font-size:13px">All checks passed.</p>`;
}

// ─── Debug section ────────────────────────────────────────────────────────────

function renderDebug({ states, matches, prdAcs, coverageGaps, meta, aiStats, now }) {
  const stateRows = states.map(s => {
    const m = matches.find(x => x.stateId === s.id);
    return `<tr>
      <td><code style="font-size:11px">${escapeHtml(s.id)}</code></td>
      <td style="font-size:12px">${escapeHtml(s.triggerDesc)}</td>
      <td><span class="pill ${m?.status??'unmatched'}">${m?.status??'unmatched'}</span></td>
      <td style="font-size:12px">${m?.frameName ? escapeHtml(m.frameName) : "—"}</td>
      <td style="font-size:12px">${m ? (m.confidence*100).toFixed(0)+"%" : "—"}</td>
    </tr>`;
  }).join("");

  const prdBlock = prdAcs?.length ? `
    <div style="margin-top:16px">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">PRD Acceptance Criteria</div>
      <table><thead><tr><th>Criterion</th><th>Status</th></tr></thead><tbody>
        ${prdAcs.map(a => `<tr><td style="font-size:12px">${escapeHtml(a.text)}</td><td><span class="pill ${a.status}">${a.status}</span></td></tr>`).join("")}
      </tbody></table>
    </div>` : "";

  const gapsBlock = (coverageGaps.missingScreens.length || coverageGaps.untestedActions.length) ? `
    <div style="margin-top:16px">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Coverage Gaps</div>
      ${coverageGaps.missingScreens.map(s=>`<div class="finding error"><div class="f-head">MISSING SCREEN</div><div class="f-desc">${escapeHtml(s)}</div></div>`).join("")}
      ${coverageGaps.untestedActions.map(a=>`<div class="finding warn"><div class="f-head">UNTESTED ACTION</div><div class="f-desc">${escapeHtml(a)}</div></div>`).join("")}
    </div>` : "";

  return `
    <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">State Map</div>
    <table><thead><tr><th>ID</th><th>Trigger</th><th>Status</th><th>Figma Frame</th><th>Confidence</th></tr></thead>
    <tbody>${stateRows}</tbody></table>
    ${prdBlock}
    ${gapsBlock}
    <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--muted)">
      <div>Live URL: ${escapeHtml(meta.liveUrl)}</div>
      <div>Figma file: ${escapeHtml(meta.figmaFileKey??'—')}</div>
      <div>Generated: ${escapeHtml(now)}</div>
      <div>AI cost: $${(aiStats?.cost??0).toFixed(3)} · ${aiStats?.textCalls??0} text · ${aiStats?.visionCalls??0} vision</div>
    </div>`;
}

// ─── Score helpers ────────────────────────────────────────────────────────────

function computeScore(findings, matches, functional) {
  const errs  = findings.filter(f => f.severity === "error").length
              + (functional?.consoleErrors?.length ?? 0)
              + (functional?.brokenLinks?.length ?? 0);
  const warns = findings.filter(f => f.severity === "warn").length
              + (functional?.formChecks?.length ?? 0);
  const totalChecks = findings.length + (functional?.testedUrls?.length ?? 0) * 3;
  if (totalChecks === 0) return { value: "N/A", noData: true, errors: errs, warns };
  const raw = 100 - Math.min(100, errs * 5 + warns * 2);
  return { value: Math.max(0, Math.round(raw)), noData: false, errors: errs, warns };
}

function scoreColor(v) {
  if (v === "N/A") return "#f97316";
  if (v >= 85) return "#22c55e";
  if (v >= 65) return "#eab308";
  return "#ef4444";
}

function scoreExplanation(score, stateCount, matchedCount, unmatchedCount, frameAnalyses) {
  if (score.noData) return "Not enough data to compute a score.";
  const parts = [];
  if (score.value >= 85)      parts.push("Implementation closely matches the designs.");
  else if (score.value >= 65) parts.push("Generally aligned with notable gaps to address.");
  else                        parts.push("Significant deviations found — review before release.");
  parts.push(`${stateCount} states explored, ${matchedCount} matched to Figma.`);
  if (unmatchedCount) parts.push(`${unmatchedCount} states had no matching frame.`);
  if (score.errors)   parts.push(`${score.errors} critical error${score.errors>1?"s":""} need attention.`);
  if (frameAnalyses.length) {
    const avg = Math.round(frameAnalyses.reduce((a,fa) => a+(fa.frameScore??0), 0) / frameAnalyses.length);
    parts.push(`Avg frame fidelity: ${avg}/100.`);
  }
  return parts.join(" ");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
