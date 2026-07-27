import { NextResponse } from "next/server";
import { resolveMember } from "@/lib/auth/api-member";
import {
  applyFeedMutation,
  feedMutationSchema,
  listFeed,
  unreadSnapshot,
} from "@/lib/notifications/platform/feed";
import type { FeedScope } from "@/lib/notifications/platform/types";

export const dynamic = "force-dynamic";

export const GET = async (req: Request) => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

  const params = new URL(req.url).searchParams;
  const scope: FeedScope = { contactId: member.contact.id };

  const feed = await listFeed(scope, {
    cursor: params.get("cursor") ?? undefined,
    unreadOnly: params.get("unreadOnly") === "true",
  });

  return NextResponse.json(feed);
};

export const POST = async (req: Request) => {
  const member = await resolveMember();
  if (member instanceof NextResponse) return member;

  const parsed = feedMutationSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const scope: FeedScope = { contactId: member.contact.id };
  const updated = await applyFeedMutation(scope, parsed.data);
  const { unread } = await unreadSnapshot(scope);

  return NextResponse.json({ ok: true, updated, unread });
};
