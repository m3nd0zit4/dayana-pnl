import { NextResponse } from "next/server";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import {
  createSocialPost,
  listSocialAccounts,
  listSocialPosts,
} from "@/lib/crm/social-posts";
import { resolveSocialPublishingEnabled } from "@/lib/tiktok/resolve-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async () => {
  if (!(await resolveSocialPublishingEnabled())) {
    return NextResponse.json({ error: "tiktok_disabled" }, { status: 404 });
  }

  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const [accounts, posts] = await Promise.all([
    listSocialAccounts(),
    listSocialPosts(),
  ]);

  return NextResponse.json({ accounts, posts });
};

export const POST = async (req: Request) => {
  if (!(await resolveSocialPublishingEnabled())) {
    return NextResponse.json({ error: "tiktok_disabled" }, { status: 404 });
  }

  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const input = payload as {
    accountId?: string;
    caption?: string;
    mediaUrls?: string[];
    privacyLevel?: string;
    scheduledAt?: string | null;
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;
  };

  if (!input.accountId) {
    return NextResponse.json({ error: "missing_account" }, { status: 400 });
  }
  if (!input.mediaUrls?.length) {
    return NextResponse.json({ error: "missing_media" }, { status: 400 });
  }

  // Una fecha pasada publicaría en el siguiente barrido del cron, que casi
  // nunca es lo que el operador quiso al escribirla.
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }
  if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: "date_in_past" }, { status: 400 });
  }

  try {
    const post = await createSocialPost({
      accountId: input.accountId,
      caption: input.caption ?? null,
      mediaUrls: input.mediaUrls,
      privacyLevel: input.privacyLevel ?? "SELF_ONLY",
      scheduledAt,
      disableComment: input.disableComment,
      disableDuet: input.disableDuet,
      disableStitch: input.disableStitch,
      staffUserId: staff.id,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create_failed" },
      { status: 400 }
    );
  }
};
