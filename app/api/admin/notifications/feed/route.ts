import { NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import {
  applyFeedMutation,
  feedMutationSchema,
  listFeed,
  unreadSnapshot,
} from "@/lib/notifications/platform/feed";
import type { FeedScope } from "@/lib/notifications/platform/types";

export const dynamic = "force-dynamic";

export const GET = async (req: Request) => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const params = new URL(req.url).searchParams;
  const scope: FeedScope = { staffUserId: staff.id };

  const feed = await listFeed(scope, {
    cursor: params.get("cursor") ?? undefined,
    unreadOnly: params.get("unreadOnly") === "true",
  });

  return NextResponse.json(feed);
};

export const POST = async (req: Request) => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = feedMutationSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const scope: FeedScope = { staffUserId: staff.id };
  const updated = await applyFeedMutation(scope, parsed.data);
  const { unread } = await unreadSnapshot(scope);

  return NextResponse.json({ ok: true, updated, unread });
};
