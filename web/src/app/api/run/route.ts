/**
 * POST /api/run
 *   multipart: figmaUrl, liveUrl, prd?
 *
 *   1. Generate runId
 *   2. If PRD provided, upload to gh-pages (raw.githubusercontent.com for instant availability)
 *   3. Trigger GitHub Actions via repository_dispatch
 *   4. Return runId so client can redirect to /report/:runId (with progress polling)
 */

import { NextRequest, NextResponse } from "next/server";

const GH_TOKEN = process.env.GH_TOKEN!;
const GH_REPO  = process.env.GITHUB_REPO || "pratikasw12112001/qa-agent";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const figmaUrl = String(form.get("figmaUrl") || "").trim();
    const liveUrl  = String(form.get("liveUrl")  || "").trim();
    const prd      = form.get("prd") as File | null;

    if (!figmaUrl || !liveUrl) {
      return NextResponse.json({ error: "figmaUrl and liveUrl required" }, { status: 400 });
    }
    if (!GH_TOKEN) {
      return NextResponse.json({ error: "GH_TOKEN not configured on server" }, { status: 500 });
    }

    const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    // Upload PRD if provided
    let prdUrl = "";
    if (prd && prd.size > 0) {
      const buf = Buffer.from(await prd.arrayBuffer());
      const path = `prd/${runId}.pdf`;
      const ok = await uploadToGhPages(path, buf, `prd: upload ${runId}`);
      if (ok) prdUrl = `https://raw.githubusercontent.com/${GH_REPO}/gh-pages/${path}`;
    }

    // Trigger dispatch
    const dispatchRes = await fetch(`https://api.github.com/repos/${GH_REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "qa-run",
        client_payload: { runId, figmaUrl, liveUrl, prdUrl },
      }),
    });
    if (!dispatchRes.ok) {
      const body = await dispatchRes.text();
      return NextResponse.json(
        { error: `GitHub dispatch failed (${dispatchRes.status}): ${body.slice(0, 200)}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ runId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function uploadToGhPages(path: string, content: Buffer, commitMessage: string): Promise<boolean> {
  const apiPath = `https://api.github.com/repos/${GH_REPO}/contents/${path}?ref=gh-pages`;
  // Check if file exists to get sha (for update)
  let sha: string | undefined;
  try {
    const check = await fetch(apiPath, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" },
    });
    if (check.ok) {
      const j = await check.json();
      sha = j.sha;
    }
  } catch {}

  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: commitMessage,
      content: content.toString("base64"),
      branch: "gh-pages",
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    console.error("gh-pages upload failed:", res.status, await res.text());
    return false;
  }
  return true;
}
