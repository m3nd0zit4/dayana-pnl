import { NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { cancelSocialPost, updateSocialPost } from "@/lib/crm/social-posts";
import { emitSocialPostPublish } from "@/lib/inngest/events";
import { resolveSocialPublishingEnabled } from "@/lib/tiktok/resolve-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Edita una publicación que aún no salió. */
export const PATCH = async (req: Request, { params }: Params) => {
  if (!(await resolveSocialPublishingEnabled())) {
    return NextResponse.json({ error: "tiktok_disabled" }, { status: 404 });
  }

  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const input = body as {
    caption?: string | null;
    privacyLevel?: string;
    scheduledAt?: string | null;
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;
  };

  let scheduledAt: Date | null | undefined;
  if (input.scheduledAt !== undefined) {
    if (input.scheduledAt === null) {
      scheduledAt = null;
    } else {
      const parsed = new Date(input.scheduledAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "invalid_date" }, { status: 400 });
      }
      // Igual que al crear: una fecha pasada publicaría en el siguiente barrido
      // del cron, que casi nunca es lo que se quiso decir.
      if (parsed.getTime() < Date.now() - 60_000) {
        return NextResponse.json({ error: "date_in_past" }, { status: 400 });
      }
      scheduledAt = parsed;
    }
  }

  try {
    return NextResponse.json(
      await updateSocialPost(
        id,
        {
          caption: input.caption,
          privacyLevel: input.privacyLevel,
          scheduledAt,
          disableComment: input.disableComment,
          disableDuet: input.disableDuet,
          disableStitch: input.disableStitch,
        },
        staff.id
      )
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "update_failed" },
      { status: 400 }
    );
  }
};

export const POST = async (req: Request, { params }: Params) => {
  if (!(await resolveSocialPublishingEnabled())) {
    return NextResponse.json({ error: "tiktok_disabled" }, { status: 404 });
  }

  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const action = (body as { action?: string }).action;

  try {
    if (action === "cancel") {
      return NextResponse.json(await cancelSocialPost(id, staff.id));
    }

    if (action === "publish_now") {
      // Se encola en vez de publicar en línea: subir un vídeo tarda más de lo
      // que debe durar una petición HTTP, y así comparte camino con el cron.
      const queued = await emitSocialPostPublish(id);
      if (!queued) {
        return NextResponse.json(
          { error: "inngest_unavailable" },
          { status: 503 }
        );
      }
      return NextResponse.json({ id, queued: true });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "action_failed" },
      { status: 400 }
    );
  }
};
