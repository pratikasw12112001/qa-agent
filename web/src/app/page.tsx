"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prdFileName, setPrdFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = e.currentTarget;
    const figmaUrl = (form.elements.namedItem("figmaUrl") as HTMLInputElement).value.trim();
    const liveUrl = (form.elements.namedItem("liveUrl") as HTMLInputElement).value.trim();
    const file = fileRef.current?.files?.[0];

    try {
      const fd = new FormData();
      fd.append("figmaUrl", figmaUrl);
      fd.append("liveUrl", liveUrl);
      if (file) fd.append("prd", file);

      const res = await fetch("/api/run", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start run");

      router.push(`/report/${data.runId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: "560px" }}>

        <header style={{ textAlign: "center", marginBottom: "36px" }}>
          <div style={{ fontSize: "40px", marginBottom: "10px" }}>🔍</div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, marginBottom: "6px" }}>Frontend QA Agent</h1>
          <p style={{ color: "#94a3b8", fontSize: "14px" }}>
            Compare Figma designs against your live app. Get a quality report in minutes.
          </p>
        </header>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          <div>
            <label style={label}>Figma File URL</label>
            <input name="figmaUrl" required placeholder="https://www.figma.com/design/…" style={input} />
            <p style={hint}>Paste the file URL — all frames will be auto-detected</p>
          </div>

          <div>
            <label style={label}>Live App URL (source page)</label>
            <input name="liveUrl" required placeholder="https://your-app.com/dashboard" style={input} />
            <p style={hint}>The agent logs in and starts exploration from this URL</p>
          </div>

          <div>
            <label style={label}>PRD Document <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span></label>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: "1px dashed #2d3660", borderRadius: "10px",
                padding: "20px", textAlign: "center", cursor: "pointer", background: "#111827",
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                onChange={(e) => setPrdFileName(e.target.files?.[0]?.name ?? null)}
              />
              <div style={{ fontSize: "24px", marginBottom: "6px" }}>📄</div>
              {prdFileName
                ? <p style={{ fontSize: "13px", color: "#22c55e", fontWeight: 600 }}>✓ {prdFileName}</p>
                : <p style={{ fontSize: "13px", color: "#94a3b8" }}>Click to upload PDF</p>}
              <p style={{ fontSize: "11px", color: "#475569", marginTop: "4px" }}>
                Enables acceptance-criteria checking against live states
              </p>
            </div>
          </div>

          {error && (
            <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: "8px", padding: "10px 14px", color: "#ef4444", fontSize: "13px" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? "#1e2640" : "#3b4fd8",
              color: loading ? "#94a3b8" : "#fff",
              border: "none", borderRadius: "10px", padding: "13px",
              fontSize: "15px", fontWeight: 700, cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Starting run…" : "Run QA Test →"}
          </button>
        </form>

        <div style={{ marginTop: "32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {[
            ["Smart exploration", "Clicks content buttons — not the sidebar"],
            ["AI matching", "Visual + text + structure signals per state"],
            ["Visual diff", "Finds layout, color, typography, missing elements"],
            ["PRD checklist", "Maps acceptance criteria to live states"],
          ].map(([title, desc]) => (
            <div key={title} style={{ background: "#111827", border: "1px solid #1e2640", borderRadius: "10px", padding: "12px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "2px" }}>{title}</div>
              <div style={{ fontSize: "11px", color: "#94a3b8" }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const label: React.CSSProperties = { display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" };
const input: React.CSSProperties = {
  width: "100%", background: "#111827", border: "1px solid #2d3660", borderRadius: "8px",
  padding: "10px 14px", color: "#e2e8f0", fontSize: "14px", outline: "none",
};
const hint: React.CSSProperties = { fontSize: "11px", color: "#475569", marginTop: "4px" };
