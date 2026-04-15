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
    const figmaUrl  = (form.elements.namedItem("figmaUrl") as HTMLInputElement).value.trim();
    const liveUrl   = (form.elements.namedItem("liveUrl") as HTMLInputElement).value.trim();
    const file      = fileRef.current?.files?.[0];

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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: "540px" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔍</div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, marginBottom: "8px" }}>Frontend QA Agent</h1>
          <p style={{ color: "#64748b", fontSize: "15px" }}>
            Compare Figma designs against your live app. Get a full report in minutes.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

          <div>
            <label style={labelStyle}>Figma File URL</label>
            <input
              name="figmaUrl"
              required
              placeholder="https://www.figma.com/design/XXXXXXXXX/..."
              style={inputStyle}
            />
            <p style={hintStyle}>Paste the URL of your Figma file (not a specific frame)</p>
          </div>

          <div>
            <label style={labelStyle}>Live Site URL</label>
            <input
              name="liveUrl"
              required
              placeholder="https://your-app.com"
              style={inputStyle}
            />
            <p style={hintStyle}>The root URL of your live application</p>
          </div>

          <div>
            <label style={labelStyle}>PRD Document <span style={{ color: "#64748b", fontWeight: 400 }}>(optional)</span></label>
            <div
              style={{
                border: "1px dashed #2d3660", borderRadius: "10px", padding: "20px",
                textAlign: "center", cursor: "pointer", background: "#161b27",
              }}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                onChange={(e) => setPrdFileName(e.target.files?.[0]?.name ?? null)}
              />
              <div style={{ fontSize: "24px", marginBottom: "6px" }}>📄</div>
              {prdFileName ? (
                <p style={{ fontSize: "13px", color: "#22c55e", fontWeight: 600 }}>✓ {prdFileName}</p>
              ) : (
                <p style={{ fontSize: "13px", color: "#64748b" }}>Click to upload PDF</p>
              )}
              <p style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>
                Enables Phase 4 — AC checklist, copy validation, feature completeness
              </p>
            </div>
          </div>

          {error && (
            <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: "8px", padding: "12px 16px", color: "#ef4444", fontSize: "14px" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? "#1e2640" : "#3b4fd8",
              color: loading ? "#64748b" : "#fff",
              border: "none", borderRadius: "10px", padding: "14px",
              fontSize: "15px", fontWeight: 700, cursor: loading ? "default" : "pointer",
              transition: "background .15s",
            }}
          >
            {loading ? "Starting run…" : "Run QA Test →"}
          </button>

        </form>

        {/* What it tests */}
        <div style={{ marginTop: "36px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          {[
            ["Phase 1", "Visual", "Typography, colors, spacing, sizes"],
            ["Phase 2", "Functional", "Clicks, search, filters, navigation"],
            ["Phase 3", "QA", "Accessibility, performance, responsiveness"],
            ["Phase 4", "PRD", "AC checklist, copy validation (needs PDF)"],
          ].map(([phase, title, desc]) => (
            <div key={phase} style={{ background: "#161b27", border: "1px solid #1e2640", borderRadius: "10px", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: "#3b4fd8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: "3px" }}>{phase}</div>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "3px" }}>{title}</div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>{desc}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "14px", fontWeight: 600, marginBottom: "6px",
};
const inputStyle: React.CSSProperties = {
  width: "100%", background: "#161b27", border: "1px solid #2d3660", borderRadius: "8px",
  padding: "10px 14px", color: "#e2e8f0", fontSize: "14px", outline: "none",
};
const hintStyle: React.CSSProperties = {
  fontSize: "12px", color: "#475569", marginTop: "5px",
};
