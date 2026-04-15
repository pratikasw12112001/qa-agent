import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
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

    // Upload PRD to Vercel Blob if provided
    let prdBlobUrl: string | undefined;
    if (prdFile && prdFile.size > 0) {
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      if (!blobToken) {
        return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN not configured" }, { status: 500 });
      }
      const pdfBuf = await prdFile.arrayBuffer();
      const blob = await put(`pdfs/${runId}.pdf`, Buffer.from(pdfBuf), {
        access: "public",
        contentType: "application/pdf",
        token: blobToken,
        addRandomSuffix: false,
      });
      prdBlobUrl = blob.url;
    }

    // Write initial progress marker to Blob
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (blobToken) {
      await put(
        `progress/${runId}.json`,
        JSON.stringify({ runId, status: "queued", queuedAt: new Date().toISOString() }),
        { access: "public", token: blobToken, contentType: "application/json", addRandomSuffix: false }
      );
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
          client_payload: { runId, figmaUrl, liveUrl, prdBlobUrl: prdBlobUrl ?? null },
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
