import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getFreeWebinar } from "@/lib/crm/free-webinar";
import { isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Large promo videos stream through this route; keep headroom for cold starts. */
export const maxDuration = 60;

/**
 * Public playback for the free-webinar promo video.
 *
 * The Blob store is private-only, so the raw `videoUrl` cannot be used in a
 * `<video src>`. This route authenticates to Blob server-side and streams
 * bytes (including Range) so seeking works in the player.
 */
export async function GET(req: NextRequest) {
  if (!isBlobConfigured()) {
    return NextResponse.json({ error: "blob_not_configured" }, { status: 503 });
  }

  const webinar = await getFreeWebinar();
  if (!webinar?.videoUrl) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const range = req.headers.get("range");
  const ifNoneMatch = req.headers.get("if-none-match") ?? undefined;

  const result = await get(webinar.videoUrl, {
    access: "private",
    ifNoneMatch,
    headers: range ? { range } : undefined,
  });

  if (!result) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (result.statusCode === 304) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: result.blob.etag,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  }

  if (!result.stream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    result.blob.contentType ?? "video/mp4"
  );
  headers.set("Accept-Ranges", "bytes");
  headers.set(
    "Cache-Control",
    "public, max-age=3600, stale-while-revalidate=86400"
  );
  headers.set("ETag", result.blob.etag);

  const contentRange = result.headers.get("content-range");
  const contentLength = result.headers.get("content-length");
  if (contentRange) headers.set("Content-Range", contentRange);
  if (contentLength) headers.set("Content-Length", contentLength);

  // Blob `get()` types status as 200 | 304; Range responses surface via Content-Range.
  const status = contentRange ? 206 : 200;

  return new NextResponse(result.stream, { status, headers });
}
