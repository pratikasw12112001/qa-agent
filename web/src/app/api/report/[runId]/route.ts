/**
 * GET /api/report/:runId
 *
 * Proxies the report HTML directly from raw.githubusercontent.com (gh-pages branch).
 * This avoids the 1-3 min GitHub Pages CDN propagation delay that caused 404s
 * when the iframe loaded pratikasw12112001.github.io before Pages finished deploying.
 *
 * raw.githubusercontent.com reflects the branch commit immediately.
 */

import { NextRequest, NextResponse } from "next/server";

const GH_REPO = process.env.GITHUB_REPO || "pratikasw12112001/qa-agent";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> }
) {
  const { runId } = await ctx.params;

  // Sanitise: runId must be alphanumeric + hyphens only
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) {
    return new NextResponse("Invalid run ID", { status: 400 });
  }

  const rawUrl = `https://raw.githubusercontent.com/${GH_REPO}/gh-pages/reports/${runId}.html?t=${Date.now()}`;

  try {
    const upstream = await fetch(rawUrl, { cache: "no-store" });

    if (!upstream.ok) {
      if (upstream.status === 404) {
        return new NextResponse(
          `<!DOCTYPE html><html><head><meta charset="utf-8">
          <style>body{font-family:system-ui;background:#09090B;color:#A1A1AA;
            display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;}
            code{background:#18181B;padding:2px 8px;border-radius:4px;font-size:12px;}
          </style></head><body>
          <p style="font-size:15px;color:#FAFAFA">Report not ready yet</p>
          <p>Run <code>${runId}</code> — the report file has not been published yet.</p>
          <p style="font-size:12px">This page will refresh automatically.</p>
          <script>setTimeout(()=>location.reload(),8000)</script>
          </body></html>`,
          { status: 202, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
      return new NextResponse(`Upstream error ${upstream.status}`, { status: 502 });
    }

    const html = await upstream.text();
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new NextResponse("Failed to fetch report", { status: 502 });
  }
}
