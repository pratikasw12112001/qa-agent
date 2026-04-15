"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Status = "pending" | "queued" | "running" | "done" | "error";

interface Progress {
  status: Status;
  currentScreen?: number;
  totalScreens?: number;
  screenName?: string;
  reportUrl?: string;
  error?: string;
}

export default function ReportPage() {
  const params = useParams();
  const runId = params.runId as string;

  const [progress, setProgress] = useState<Progress>({ status: "pending" });
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (progress.status === "done" || progress.status === "error") return;
    if (attempts >= 120) { // 10 minutes max
      setProgress((p) => ({ ...p, status: "error", error: "Timed out after 10 minutes" }));
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/status/${runId}`);
        const data = await res.json();
        setProgress(data);
        setAttempts((a) => a + 1);
      } catch {
        setAttempts((a) => a + 1);
      }
    }, 5000);

    return () => clearTimeout(timeout);
  }, [runId, progress.status, attempts]);

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  if (progress.status === "done" && progress.reportUrl) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        {/* Toolbar */}
        <div style={{
          background: "#161b27", borderBottom: "1px solid #1e2640",
          padding: "10px 20px", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0,
        }}>
          <a href="/" style={{ color: "#60a5fa", fontSize: "13px", textDecoration: "none" }}>← New run</a>
          <span style={{ color: "#2d3660" }}>|</span>
          <span style={{ fontSize: "13px", color: "#94a3b8" }}>Run {runId}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
            <button
              onClick={() => { navigator.clipboard?.writeText(shareUrl); }}
              style={btnStyle}
            >
              🔗 Copy link
            </button>
            <a href={progress.reportUrl} download={`qa-${runId}.html`} style={{ ...btnStyle, textDecoration: "none", display: "inline-block", lineHeight: "1" }}>
              ⬇ Download
            </a>
          </div>
        </div>
        {/* Report iframe */}
        <iframe
          src={progress.reportUrl}
          style={{ flex: 1, border: "none", width: "100%" }}
          title="QA Report"
        />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ textAlign: "center", maxWidth: "460px" }}>

        {progress.status === "error" ? (
          <>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>❌</div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>Run failed</h2>
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "20px" }}>{progress.error}</p>
            <a href="/" style={{ ...btnStyle, textDecoration: "none", display: "inline-block" }}>← Try again</a>
          </>
        ) : (
          <>
            {/* Spinner */}
            <div style={{ marginBottom: "24px" }}>
              <svg width="48" height="48" viewBox="0 0 48 48" style={{ animation: "spin 1s linear infinite" }}>
                <circle cx="24" cy="24" r="20" fill="none" stroke="#1e2640" strokeWidth="4"/>
                <path d="M24 4 A20 20 0 0 1 44 24" fill="none" stroke="#3b4fd8" strokeWidth="4" strokeLinecap="round"/>
              </svg>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>

            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>Running QA tests…</h2>
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "20px" }}>
              Run ID: <code style={{ color: "#94a3b8", fontSize: "13px" }}>{runId}</code>
            </p>

            {/* Phase progress */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "24px" }}>
              {[
                ["Phase 1", "Visual Comparison"],
                ["Phase 2", "Functional Tests"],
                ["Phase 3", "QA Checks"],
                ["Phase 4", "PRD Compliance"],
              ].map(([phase, label], i) => (
                <div key={phase} style={{
                  background: "#161b27", border: "1px solid #1e2640", borderRadius: "8px",
                  padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px",
                  opacity: progress.status === "running" || progress.status === "queued" ? 1 : 0.5,
                }}>
                  <span style={{ fontSize: "16px" }}>
                    {i < 1 ? "⏳" : "⏸"}
                  </span>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>{phase}</div>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>{label}</div>
                  </div>
                  {progress.currentScreen && i === 0 && (
                    <span style={{ marginLeft: "auto", fontSize: "12px", color: "#94a3b8" }}>
                      {progress.currentScreen}/{progress.totalScreens} screens
                    </span>
                  )}
                </div>
              ))}
            </div>

            <p style={{ fontSize: "12px", color: "#475569" }}>
              Checking every ~5s • typically takes 8–15 min
              {attempts > 0 && ` • ${attempts} checks`}
            </p>

            <div style={{ marginTop: "20px" }}>
              <button
                onClick={() => { navigator.clipboard?.writeText(shareUrl); }}
                style={{ ...btnStyle, background: "transparent", border: "1px solid #2d3660", color: "#94a3b8" }}
              >
                🔗 Copy link to share while waiting
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#1e2640", border: "none", borderRadius: "7px",
  padding: "8px 14px", fontSize: "13px", color: "#e2e8f0", cursor: "pointer",
};
