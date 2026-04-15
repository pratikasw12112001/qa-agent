import { NextRequest, NextResponse } from "next/server";

const GH_PAGES_BASE = "https://pratikasw12112001.github.io/qa-agent";

export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;

  try {
    // Poll the progress JSON published to GitHub Pages by the workflow
    const progressUrl = `${GH_PAGES_BASE}/progress/${runId}.json`;
    const res = await fetch(progressUrl, {
      // Bust the GitHub Pages CDN cache
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      cache: "no-store",
    });

    if (!res.ok) {
      // Not yet written → still queued
      return NextResponse.json({ status: "queued" });
    }

    const progress = await res.json();

    // If done, verify the HTML file also exists
    if (progress.status === "done") {
      const reportUrl = `${GH_PAGES_BASE}/reports/${runId}.html`;
      const rr = await fetch(reportUrl, { method: "HEAD", cache: "no-store" });
      if (rr.ok) {
        return NextResponse.json({ status: "done", reportUrl });
      }
      // Still deploying — return running
      return NextResponse.json({ status: "running", message: "Uploading report…" });
    }

    return NextResponse.json({ status: progress.status ?? "running", ...progress });
  } catch (err) {
    return NextResponse.json({ status: "error", error: String(err) }, { status: 500 });
  }
}
