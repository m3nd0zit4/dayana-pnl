import { withStaff } from "@/lib/api/handler";
import { unreadSnapshot } from "@/lib/notifications/platform/feed";
import {
  createFeedStream,
  SSE_HEADERS,
} from "@/lib/notifications/platform/stream";
import type { FeedScope } from "@/lib/notifications/platform/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withStaff("read", async ({ req, staff }) => {
  const scope: FeedScope = { staffUserId: staff.id };

  const stream = createFeedStream({
    poll: () => unreadSnapshot(scope),
    signal: req.signal,
    lastEventId: req.headers.get("last-event-id") ?? undefined,
  });

  return new Response(stream, { headers: SSE_HEADERS });
});
