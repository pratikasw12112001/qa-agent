"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Progress = {
  status: "queued" | "running" | "done" | "error";
  queuedAt?: string;
  completedAt?: string;
  reportUrl?: string;
  error?: string;
};

export default function ReportPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;

  const [progress, setProgress] = useState<Progress>({ status: "queued" });
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/progress/${runId}`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setProgress(data);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5000);
    const tickId = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => { cancelled = true; clearInterval(id); clearInterval(tickId); };
  }, [runId]);

  const done = progress.status === "done";
  const err  = progress.status === "error";

  if (done && progress.reportUrl) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#0b1020" }}>
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderBottom: "1px solid #1e2640", background: "#0b1020",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <a href="/" style={{ color: "#94a3b8", fontSize: "13px", textDecoration: "none" }}>← New run</a>
            <span style={{ color: "#475569", fontSize: "13px" }}>|</span>
            <span style={{ color: "#94a3b8", fontSize: "13px" }}>
              Run <code style={{ background: "#111827", padding: "2px 6px", borderRadius: "4px" }}>{runId}</code>
            </span>
          </div>
          <a
            href={progress.reportUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#3b82f6", fontSize: "13px", textDecoration: "none" }}
          >
            Open in new tab ↗
          </a>
        </header>
        <iframe
          src={progress.reportUrl}
          style={{ flex: 1, width: "100%", border: "none", background: "#fff" }}
          title={`QA Report ${runId}`}
        />
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: "620px", textAlign: "center" }}>
        <div style={{ fontSize: "40px", marginBottom: "14px" }}>{err ? "✖" : "⏳"}</div>
        <h1 style={{ fontSize: "24px", fontWeight: 800, marginBottom: "6px" }}>
          {err ? "Run failed" : "Running QA agent…"}
        </h1>
        <p style={{ color: "#94a3b8", fontSize: "14px", marginBottom: "28px" }}>
          Run <code style={{ background: "#111827", padding: "2px 6px", borderRadius: "4px" }}>{runId}</code>
          {!err && ` · elapsed ${formatTime(elapsed)}`}
        </p>

        {!err && (
          <div style={{ background: "#111827", border: "1px solid #1e2640", borderRadius: "12px", padding: "24px", marginBottom: "18px" }}>
            <div style={{ color: "#94a3b8", fontSize: "13px", marginBottom: "10px" }}>Status: {progress.status}</div>
            <div style={{ height: "6px", background: "#1e2640", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: progress.status === "running" ? "60%" : "15%",
                background: "linear-gradient(90deg,#3b4fd8,#22c55e)",
                transition: "width .5s ease",
              }} />
            </div>
            <p style={{ color: "#64748b", fontSize: "12px", marginTop: "14px" }}>
              Typical run: 3-6 min · polling every 5 sec
            </p>
          </div>
        )}

        {err && (
          <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: "8px", padding: "14px 18px", color: "#ef4444", fontSize: "13px" }}>
            {progress.error ?? "The run ended with errors. Check GitHub Actions for details."}
          </div>
        )}

        <div style={{ marginTop: "24px" }}>
          <a href="/" style={{ color: "#94a3b8", fontSize: "13px", textDecoration: "none" }}>← Start another run</a>
        </div>
      </div>
    </main>
  );
}

function formatTime(s: number) {
  const m = Math.floor(s / 60); const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
