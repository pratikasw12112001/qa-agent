import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const GH_TOKEN  = process.env.GH_TOKEN;
const GH_REPO   = process.env.GITHUB_REPO ?? "pratikasw12112001/qa-agent";
const GH_API    = "https://api.github.com";

/** Store the PDF on gh-pages branch so the workflow can download it by URL */
async function uploadPdfToGhPages(runId: string, buf: Buffer): Promise<string | null> {
  if (!GH_TOKEN) return null;
  const path = `pdfs/${runId}.pdf`;
  const content = buf.toString("base64");

  // Check if file already exists (need its SHA for updates)
  let sha: string | undefined;
  try {
    const existing = await fetch(
      `${GH_API}/repos/${GH_REPO}/contents/${path}?ref=gh-pages`,
      { headers: { Authorization: `token ${GH_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (existing.ok) sha = (await existing.json()).sha;
  } catch { /* new file */ }

  const body: Record<string, string> = {
    message: `pdf: ${runId}`,
    content,
    branch: "gh-pages",
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${GH_API}/repos/${GH_REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${GH_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("PDF upload to gh-pages failed:", res.status, await res.text());
    return null;
  }
  // Use raw.githubusercontent.com — available immediately (no Pages deploy wait)
  return `https://raw.githubusercontent.com/${GH_REPO}/gh-pages/${path}`;
}

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

    // Upload PRD PDF to gh-pages branch and get a URL the workflow can download
    let prdUrl: string | null = null;
    if (prdFile && prdFile.size > 0) {
      const buf = Buffer.from(await prdFile.arrayBuffer());
      prdUrl = await uploadPdfToGhPages(runId, buf);
    }

    if (!GH_TOKEN || !GH_REPO) {
      return NextResponse.json(
        { error: "GH_TOKEN or GITHUB_REPO not configured." },
        { status: 500 }
      );
    }

    const dispatchRes = await fetch(
      `${GH_API}/repos/${GH_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${GH_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "qa-run",
          client_payload: { runId, figmaUrl, liveUrl, prdUrl },
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
