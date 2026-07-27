import { NextResponse } from "next/server";
import { resolveMember } from "@/lib/auth/api-member";
import { unreadSnapshot } from "@/lib/notifications/platform/feed";
import {
  createFeedStream,
  SSE_HEADERS,
} from "@/lib/notifications/platform/stream";
import type { FeedScope } from "@/lib/notifications/platform/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = async (req: Request) => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

  const scope: FeedScope = { contactId: member.contact.id };

  const stream = createFeedStream({
    poll: () => unreadSnapshot(scope),
    signal: req.signal,
    lastEventId: req.headers.get("last-event-id") ?? undefined,
  });

  return new Response(stream, { headers: SSE_HEADERS });
};
