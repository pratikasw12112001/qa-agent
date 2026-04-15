import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const figmaUrl = form.get("figmaUrl") as string;
    const liveUrl  = form.get("liveUrl") as string;
    const prdFile  = form.get("prd") as File | null;

    if (!figmaUrl || !liveUrl) {
      return NextResponse.json({ error: "figmaUrl and liveUrl are required" }, { status: 400 });
    }

    const runId = crypto.randomBytes(6).toString("hex");

    // Store PRD as base64 in the dispatch payload if provided (max ~5MB)
    let prdBase64: string | null = null;
    if (prdFile && prdFile.size > 0 && prdFile.size < 5 * 1024 * 1024) {
      const buf = await prdFile.arrayBuffer();
      prdBase64 = Buffer.from(buf).toString("base64");
    }

    // Trigger GitHub Actions via repository_dispatch
    const ghToken = process.env.GH_TOKEN;
    const ghRepo  = process.env.GITHUB_REPO; // format: "owner/repo"

    if (!ghToken || !ghRepo) {
      return NextResponse.json(
        { error: "GH_TOKEN or GITHUB_REPO not configured. Set these in Vercel environment variables." },
        { status: 500 }
      );
    }

    const dispatchRes = await fetch(
      `https://api.github.com/repos/${ghRepo}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${ghToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "qa-run",
          client_payload: { runId, figmaUrl, liveUrl, prdBase64 },
        }),
      }
    );

    if (!dispatchRes.ok) {
      const text = await dispatchRes.text();
      return NextResponse.json(
        { error: `GitHub dispatch failed (${dispatchRes.status}): ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ runId });
  } catch (err: unknown) {
    console.error("POST /api/run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
