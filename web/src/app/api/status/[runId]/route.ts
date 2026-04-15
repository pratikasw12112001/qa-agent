import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;

  try {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      return NextResponse.json({ status: "error", error: "BLOB_READ_WRITE_TOKEN not set" }, { status: 500 });
    }

    // Check if the finished report exists
    const reportUrl = `https://${getStoreDomain(blobToken)}/reports/${runId}.html`;
    const reportRes = await fetch(reportUrl, { method: "HEAD" });
    if (reportRes.ok) {
      return NextResponse.json({ status: "done", reportUrl });
    }

    // Check progress JSON
    const progressUrl = `https://${getStoreDomain(blobToken)}/progress/${runId}.json`;
    const progressRes = await fetch(progressUrl);
    if (progressRes.ok) {
      const progress = await progressRes.json();
      return NextResponse.json({ status: progress.status ?? "running", ...progress });
    }

    return NextResponse.json({ status: "pending" });
  } catch (err) {
    return NextResponse.json({ status: "error", error: String(err) }, { status: 500 });
  }
}

/**
 * Derive the Vercel Blob store domain from the token.
 * Blob public URLs are: https://<store-hash>.public.blob.vercel-storage.com/...
 * The token is in format: vercel_blob_rw_<storeHash>_<secret>
 */
function getStoreDomain(token: string): string {
  const match = token.match(/vercel_blob_rw_([a-zA-Z0-9]+)_/);
  if (match) return `${match[1].toLowerCase()}.public.blob.vercel-storage.com`;
  // Fallback — the BLOB_PUBLIC_BASE_URL env var can be set manually
  return process.env.BLOB_PUBLIC_BASE_URL ?? "blob.vercel-storage.com";
}
