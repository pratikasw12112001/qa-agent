export function generateReport({
  runId, meta, frames, states, matches, findings, frameAnalyses = [],
  functional, prdAcs, coverageGaps = { missingScreens: [], untestedActions: [] },
  aiStats, warnings = [],
}) {
  const now   = new Date().toISOString();

  const matched   = matches.filter((m) => m.status === "matched");
  const review    = matches.filter((m) => m.status === "review");
  const unmatched = matches.filter((m) => m.status === "unmatched");

  const nonCssFindings = findings.filter(f => f.category !== "css");
  const hasIssues   = nonCssFindings.length > 0;
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
  /* Issue filter buttons */
  .ifl{background:var(--panel2);border:1px solid var(--border);border-radius:20px;
       color:var(--muted);font-size:11px;font-weight:600;padding:4px 12px;cursor:pointer;}
  .ifl:hover{border-color:var(--blue);color:var(--text);}
  .ifl.on{background:var(--blue);border-color:var(--blue);color:#fff;}

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
  <a href="#logs">Logs</a>
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
  <div class="hero-body" style="flex:1">
    <div class="hero-title">Frontend QA Report</div>
    <div class="hero-sub">${escapeHtml(meta.liveUrl)} · ${escapeHtml(now.slice(0,16).replace("T"," "))}</div>
    <div class="chips" style="margin-top:10px">
      ${nonCssFindings.filter(f=>f.severity==="error").length ? `<span class="chip e">${nonCssFindings.filter(f=>f.severity==="error").length} error${nonCssFindings.filter(f=>f.severity==="error").length>1?"s":""}</span>` : ""}
      ${nonCssFindings.filter(f=>f.severity==="warn").length  ? `<span class="chip w">${nonCssFindings.filter(f=>f.severity==="warn").length} warning${nonCssFindings.filter(f=>f.severity==="warn").length>1?"s":""}</span>`  : ""}
      ${findings.filter(f=>f.category==="css").length ? `<span class="chip i">${findings.filter(f=>f.category==="css").length} CSS deviation${findings.filter(f=>f.category==="css").length>1?"s":""}</span>` : ""}
      <span class="chip g">${matched.length + review.length} frame${matched.length+review.length!==1?"s":""} compared</span>
      ${unmatched.length ? `<span class="chip i">${unmatched.length} unmatched</span>` : ""}
      <span class="chip i">${states.length} states explored</span>
      ${frameAnalyses.length ? `<span class="chip g">avg fidelity ${Math.round(frameAnalyses.reduce((a,f)=>a+(f.frameScore??0),0)/frameAnalyses.length)}/100</span>` : ""}
    </div>
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
      <span style="font-size:12px;font-weight:400;color:var(--muted);">&nbsp;${nonCssFindings.filter(f=>f.severity==="error").length} errors · ${nonCssFindings.filter(f=>f.severity==="warn").length} warnings</span>
    </h2>
    <span class="tog">▾</span>
  </div>
  <div class="sec-body">
    <div id="issue-filters" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
      <button class="ifl on" data-f="all">All</button>
      <button class="ifl" data-f="error">Errors</button>
      <button class="ifl" data-f="warn">Warnings</button>
      ${[...new Set(nonCssFindings.map(f=>f.category).filter(Boolean))].map(c=>`<button class="ifl" data-f="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}
    </div>
    <div id="issue-list">${renderAllIssues(nonCssFindings, states)}</div>
  </div>
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

<!-- SECTION 4: LOGS -->
<section id="logs" class="shut">
  <div class="sec-hd">
    <h2>Run Logs <span class="aud">QA / PM</span></h2>
    <span class="tog">▾</span>
  </div>
  <div class="sec-body">
    ${renderLogs({ states, matches, frames, findings, functional, prdAcs, coverageGaps, warnings, aiStats })}
  </div>
</section>

<!-- SECTION 5: DEBUG -->
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

  // Issue filters
  document.querySelectorAll(".ifl").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".ifl").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      const f = btn.dataset.f;
      document.querySelectorAll("#issue-list .finding").forEach(el => {
        if (f === "all") { el.style.display = ""; return; }
        const matchSev = el.classList.contains(f);
        const matchCat = el.querySelector(".f-head")?.textContent?.toLowerCase().startsWith(f.toLowerCase());
        el.style.display = (matchSev || matchCat) ? "" : "none";
      });
    });
  });
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
  // Only show matched + review states as full cards, sorted worst fidelity first
  const relevant = states
    .filter(s => {
      const m = matches.find(x => x.stateId === s.id);
      return m && (m.status === "matched" || m.status === "review");
    })
    .sort((a, b) => {
      const fa = frameAnalyses.find(x => x.stateId === a.id);
      const fb = frameAnalyses.find(x => x.stateId === b.id);
      const sa = fa?.frameScore ?? 50;
      const sb = fb?.frameScore ?? 50;
      const ea = allFindings.filter(f => f.stateId === a.id && f.severity === "error").length;
      const eb = allFindings.filter(f => f.stateId === b.id && f.severity === "error").length;
      return (sa - ea * 10) - (sb - eb * 10);
    });
  if (!relevant.length) return `<p style="color:var(--muted);font-size:13px">No matched frames — check Figma URL and page scope.</p>`;

  return relevant.map(s => {
    const m        = matches.find(x => x.stateId === s.id);
    const frame    = m?.frameId ? frames.find(f => f.id === m.frameId) : null;
    const findings = allFindings.filter(f => f.stateId === s.id);
    const nonCssFindings = findings.filter(f => f.category !== "css");
    const errs     = nonCssFindings.filter(f => f.severity === "error").length;
    const warns    = nonCssFindings.filter(f => f.severity === "warn").length;
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

    // Form interaction badge
    const formBadge = s.formInteraction ? `
      <div style="margin-top:5px;display:inline-flex;align-items:center;gap:6px;font-size:11px;
                  background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);
                  border-radius:6px;padding:3px 8px;color:#86efac">
        <span>⌨ Form filled</span>
        <span style="color:var(--muted)">${s.formInteraction.filled.map(f=>`${escapeHtml(f.field)}: "${escapeHtml(f.value)}"`).join(" · ")}</span>
        ${s.formInteraction.submitted ? `<span style="color:#22c55e">→ submitted (${escapeHtml(s.formInteraction.submitLabel)})</span>` : `<span style="color:#eab308">→ not submitted</span>`}
      </div>` : "";

    // TAB 1 — Screenshots
    const liveImg = s.screenshot ? `
      <div>
        <div class="ss-label">Live · ${escapeHtml(s.url.replace(/^https?:\/\/[^/]+/, ""))}</div>
        <img src="data:image/jpeg;base64,${s.screenshot}" style="border:2px solid #3b82f6;" alt="live">
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

    // TAB 3 — CSS Deviations
    const cssFindings = findings.filter(f => f.category === "css");
    const tabCss = cssFindings.length ? `
      <div style="margin-bottom:8px;font-size:12px;color:var(--muted)">
        Computed CSS vs Figma design tokens — major params only (font-size, padding, color, border-radius)
      </div>
      <table style="font-size:12px;width:100%">
        <thead><tr>
          <th>Element</th><th>Property</th><th>Live</th><th>Figma</th><th></th>
        </tr></thead>
        <tbody>
        ${cssFindings.map(f => {
          // Parse description: "Button "Save": font-size is 14px in live, 16px in Figma"
          const m = f.description.match(/^(.+?):\s+(.+?) is (.+?) in live,\s*(.+?) in Figma/);
          const el   = m ? escapeHtml(m[1]) : escapeHtml(f.description);
          const prop = m ? escapeHtml(m[2]) : "";
          const lv   = m ? escapeHtml(m[3]) : "";
          const fv   = m ? escapeHtml(m[4]) : "";
          const sev  = f.severity === "error" ? "#ef4444" : "#eab308";
          return `<tr>
            <td style="color:#e2e8f0;font-weight:600">${el}</td>
            <td style="color:#94a3b8;font-family:monospace">${prop}</td>
            <td style="font-family:monospace;color:#93c5fd">${lv}</td>
            <td style="font-family:monospace;color:#86efac">${fv}</td>
            <td><span style="color:${sev};font-size:10px;font-weight:700">${f.severity.toUpperCase()}</span></td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>` :
      `<p style="color:var(--muted);font-size:13px;margin:0">
        ${s.cssProperties ? "No CSS deviations detected — live values match Figma design tokens." : "CSS extraction not available for this state."}
      </p>`;

    // TAB 4 — Issues (top 5 only, link to full Issues section for more)
    const topFindings = findings.filter(f => f.category !== "css").slice(0, 5);
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
          <button class="tb" data-t="css">CSS${cssFindings.length?` (${cssFindings.length})`:""}</button>
          <button class="tb" data-t="iss">Issues${errs+warns>0?` (${errs+warns})`:""}</button>
        </div>
        <div class="tp on" data-t="ss">${formBadge}<div class="ss-grid">${liveImg}${figmaImg}</div></div>
        <div class="tp" data-t="dim">${tabDimensions}</div>
        <div class="tp" data-t="css">${tabCss}</div>
        <div class="tp" data-t="iss">${tabIssues}</div>
      </div>
    </div>`;
  }).join("");
}

// ─── All Issues (deduped + rolled up, sorted by severity) ────────────────────

function renderAllIssues(findings, states) {
  // Roll up duplicate descriptions across states
  const groups = new Map(); // key → { finding, stateIds[] }
  for (const f of findings) {
    const key = `${f.category}||${f.severity}||${f.description}`;
    if (!groups.has(key)) groups.set(key, { finding: f, stateIds: [] });
    if (f.stateId) groups.get(key).stateIds.push(f.stateId);
  }

  const deduped = [...groups.values()].sort((a,b) => {
    const sev = { error:0, warn:1, info:2 };
    return (sev[a.finding.severity]??2) - (sev[b.finding.severity]??2);
  });

  return deduped.map(({ finding: f, stateIds }) => {
    const count = stateIds.length;
    const stateLabels = stateIds.slice(0,3).map(id => {
      const s = states.find(x => x.id === id);
      return s ? escapeHtml(s.triggerDesc) : id;
    });
    return `
      <div class="finding ${f.severity}">
        <div class="f-head">${escapeHtml((f.category||"general").toUpperCase())} · ${f.severity}
          ${count > 1 ? `<span style="background:rgba(255,255,255,.1);border-radius:4px;padding:1px 6px;margin-left:6px;font-size:10px">${count} states</span>` : ""}
        </div>
        <div class="f-desc">${escapeHtml(f.description)}</div>
        ${count > 1 ? `<div style="color:var(--muted);font-size:11px;margin-top:3px">Seen in: ${stateLabels.join(", ")}${count>3?` +${count-3} more`:""}</div>` : ""}
        ${f.evidence && count === 1 ? `<div style="color:var(--muted);font-size:11px;margin-top:3px">${escapeHtml(String(f.evidence))}</div>` : ""}
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


// ─── Run Logs ─────────────────────────────────────────────────────────────────

function renderLogs({ states, matches, frames, findings, functional, prdAcs, coverageGaps, warnings, aiStats }) {
  const rows = [];

  const logRow = (icon, color, label, detail = "") => `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:14px;flex-shrink:0;margin-top:1px">${icon}</span>
      <div style="flex:1;min-width:0">
        <span style="font-size:13px;font-weight:600;color:${color}">${escapeHtml(label)}</span>
        ${detail ? `<span style="font-size:12px;color:var(--muted);margin-left:8px">${detail}</span>` : ""}
      </div>
    </div>`;

  const group = (title) => `
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
                color:var(--muted);margin:18px 0 4px;padding-bottom:4px;border-bottom:1px solid var(--border)">
      ${title}
    </div>`;

  // ── WHAT WAS TESTED ────────────────────────────────────────────────────────

  rows.push(group("✓ What Was Tested"));

  // States explored
  rows.push(logRow("🔍", "#86efac",
    `${states.length} screen state${states.length!==1?"s":""} explored`,
    "BFS click-exploration from the source URL"
  ));

  // Per-state detail
  const matchedSet = new Set(matches.filter(m => m.frameId).map(m => m.stateId));
  for (const s of states) {
    const m     = matches.find(x => x.stateId === s.id);
    const icon  = m?.status === "matched" ? "✓" : m?.status === "review" ? "~" : "·";
    const color = m?.status === "matched" ? "#86efac" : m?.status === "review" ? "#fde68a" : "#94a3b8";
    const frame = m?.frameName ? ` → Figma: "${m.frameName}" (${(m.confidence*100).toFixed(0)}%)` : " → no Figma match";
    const errs  = findings.filter(f => f.stateId === s.id && f.severity === "error").length;
    const errTxt = errs ? ` · ${errs} error${errs>1?"s":""}` : "";
    rows.push(`
      <div style="display:flex;gap:10px;align-items:baseline;padding:4px 0 4px 24px;border-bottom:1px solid #111827">
        <span style="font-size:11px;color:${color};flex-shrink:0;font-weight:700">${icon}</span>
        <div style="min-width:0">
          <span style="font-size:12px;font-weight:600">${escapeHtml(s.triggerDesc)}</span>
          <span style="font-size:11px;color:var(--muted)">${escapeHtml(frame)}${errTxt}</span>
        </div>
      </div>`);
  }

  // Figma frames evaluated
  const framesMatched = new Set(matches.filter(m => m.frameId && (m.status==="matched"||m.status==="review")).map(m => m.frameId));
  if (frames.length) {
    rows.push(logRow("🎨", "#86efac",
      `${framesMatched.size} of ${frames.length} Figma frame${frames.length!==1?"s":""} matched`,
      "Frames scoped to the provided Figma page"
    ));
  }

  // Functional checks
  if (functional?.testedUrls?.length) {
    rows.push(logRow("🔗", "#86efac",
      `${functional.testedUrls.length} URL${functional.testedUrls.length!==1?"s":""} checked for broken links, console errors, network failures`
    ));
  }

  // A11y
  const a11yUrls = functional?.a11y?.length ?? 0;
  if (a11yUrls) {
    rows.push(logRow("♿", "#86efac", `Accessibility scan run on ${a11yUrls} page${a11yUrls!==1?"s":""}`));
  }

  // PRD
  if (prdAcs?.length) {
    const pass = prdAcs.filter(a => a.status === "pass").length;
    rows.push(logRow("📋", "#86efac",
      `${prdAcs.length} PRD acceptance criteria checked`,
      `${pass} passed · ${prdAcs.length - pass} failed/partial`
    ));
  }

  // ── WHAT WAS NOT TESTED & WHY ──────────────────────────────────────────────

  rows.push(group("⚠ What Was Not Tested & Why"));

  let anythingSkipped = false;

  // Figma frames with no live state match
  const unmatchedFrames = frames.filter(f => !framesMatched.has(f.id));
  if (unmatchedFrames.length) {
    anythingSkipped = true;
    rows.push(logRow("🎨", "#fde68a",
      `${unmatchedFrames.length} Figma frame${unmatchedFrames.length!==1?"s":""} were never matched to a live state`,
      "These designs were not verified against the live app"
    ));
    for (const f of unmatchedFrames) {
      rows.push(`
        <div style="display:flex;gap:10px;align-items:baseline;padding:3px 0 3px 24px;border-bottom:1px solid #111827">
          <span style="font-size:11px;color:#fde68a;flex-shrink:0">·</span>
          <span style="font-size:12px;color:var(--muted)">"${escapeHtml(f.name)}"
            <span style="color:var(--dim)"> — no live state reached this screen</span>
          </span>
        </div>`);
    }
  }

  // States that hit the cap (heuristic: if states.length is a round number like 40)
  const MAX_STATES = 40;
  if (states.length >= MAX_STATES) {
    anythingSkipped = true;
    rows.push(logRow("🔢", "#fde68a",
      `Exploration stopped at ${states.length} states (cap reached)`,
      "There may be more screens — increase maxStates or use a starting frame URL to focus exploration"
    ));
  }

  // Unmatched live states
  const unmatchedStates = matches.filter(m => m.status === "unmatched");
  if (unmatchedStates.length) {
    anythingSkipped = true;
    rows.push(logRow("❓", "#fde68a",
      `${unmatchedStates.length} captured state${unmatchedStates.length!==1?"s":""} had no Figma frame match`,
      "These screens exist in the live app but have no counterpart in the scoped Figma canvas"
    ));
  }

  // Figma not available
  const figmaWarn = warnings.find(w => w.step === "Figma");
  if (figmaWarn) {
    anythingSkipped = true;
    rows.push(logRow("🎨", "#fca5a5",
      "Figma design comparison skipped",
      figmaWarn.message.slice(0, 120)
    ));
  }

  // Functional tests failed
  const funcWarn = warnings.find(w => w.step === "Functional");
  if (funcWarn) {
    anythingSkipped = true;
    rows.push(logRow("🔗", "#fca5a5",
      "Functional tests did not complete",
      funcWarn.message.slice(0, 120)
    ));
  }

  // PRD not provided
  if (!prdAcs?.length) {
    anythingSkipped = true;
    rows.push(logRow("📋", "#94a3b8",
      "PRD acceptance criteria — not checked",
      "No PRD PDF was uploaded. Upload one to enable criteria checking and coverage gap detection."
    ));
  }

  // Coverage gaps from PRD
  if (coverageGaps.missingScreens?.length) {
    anythingSkipped = true;
    rows.push(logRow("📭", "#fde68a",
      `${coverageGaps.missingScreens.length} PRD-described screen${coverageGaps.missingScreens.length!==1?"s":""} never captured`,
      coverageGaps.missingScreens.slice(0,3).map(s => `"${s}"`).join(", ") + (coverageGaps.missingScreens.length > 3 ? "…" : "")
    ));
  }

  if (coverageGaps.untestedActions?.length) {
    anythingSkipped = true;
    rows.push(logRow("🔲", "#fde68a",
      `${coverageGaps.untestedActions.length} PRD-described action${coverageGaps.untestedActions.length!==1?"s":""} never triggered`,
      coverageGaps.untestedActions.slice(0,3).map(a => `"${a}"`).join(", ") + (coverageGaps.untestedActions.length > 3 ? "…" : "")
    ));
  }

  // Other warnings
  for (const w of warnings.filter(w => w.step !== "Figma" && w.step !== "Functional")) {
    anythingSkipped = true;
    rows.push(logRow("⚠", "#fca5a5", `${w.step} step had an error`, w.message.slice(0, 120)));
  }

  if (!anythingSkipped) {
    rows.push(`<div style="font-size:13px;color:var(--green);padding:8px 0">✓ Full coverage — no gaps detected.</div>`);
  }

  // ── AI USAGE ───────────────────────────────────────────────────────────────

  if (aiStats) {
    rows.push(group("AI Usage"));
    rows.push(`
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;padding:6px 0">
        ${[
          ["Text calls",   aiStats.textCalls   ?? 0],
          ["Vision calls", aiStats.visionCalls  ?? 0],
          ["Cache hits",   aiStats.cacheHits    ?? 0],
          ["Est. cost",    "$" + (aiStats.cost ?? 0).toFixed(3)],
        ].map(([k,v]) => `
          <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px 12px">
            <div style="font-size:11px;color:var(--muted)">${k}</div>
            <div style="font-size:18px;font-weight:700">${v}</div>
          </div>`).join("")}
      </div>`);
  }

  return `<div style="line-height:1">${rows.join("")}</div>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
