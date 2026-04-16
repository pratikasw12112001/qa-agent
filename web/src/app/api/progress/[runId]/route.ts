/**
 * GET /api/progress/:runId
 * Returns progress JSON from gh-pages (via raw.githubusercontent.com for freshness).
 * Shape: { status: "queued" | "running" | "done" | "error", ..., reportUrl? }
 */

import { NextRequest, NextResponse } from "next/server";

const GH_REPO = process.env.GITHUB_REPO || "pratikasw12112001/qa-agent";
const PAGES_BASE = process.env.GH_PAGES_BASE || "https://pratikasw12112001.github.io/qa-agent";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  try {
    const raw = await fetch(
      `https://raw.githubusercontent.com/${GH_REPO}/gh-pages/progress/${runId}.json?t=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!raw.ok) {
      return NextResponse.json({ status: "queued" });
    }
    const data = await raw.json();
    if (data.status === "done" && !data.reportUrl) {
      data.reportUrl = `${PAGES_BASE}/reports/${runId}.html`;
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ status: "queued" });
  }
}
