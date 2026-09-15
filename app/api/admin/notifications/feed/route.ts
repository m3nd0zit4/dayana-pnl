import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import {
  applyFeedMutation,
  feedMutationSchema,
  listFeed,
  unreadSnapshot,
} from "@/lib/notifications/platform/feed";
import type { FeedScope } from "@/lib/notifications/platform/types";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async ({ req, staff }) => {
  const params = new URL(req.url).searchParams;
  const scope: FeedScope = { staffUserId: staff.id };

  const feed = await listFeed(scope, {
    cursor: params.get("cursor") ?? undefined,
    unreadOnly: params.get("unreadOnly") === "true",
  });

  return NextResponse.json(feed);
});

export const POST = withStaff("read", async ({ req, staff }) => {
  const parsed = feedMutationSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  const scope: FeedScope = { staffUserId: staff.id };
  const updated = await applyFeedMutation(scope, parsed.data);
  const { unread } = await unreadSnapshot(scope);

  return NextResponse.json({ ok: true, updated, unread });
});
