import { NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { cancelSocialPost } from "@/lib/crm/social-posts";
import { emitSocialPostPublish } from "@/lib/inngest/events";
import { isTikTokEnabled } from "@/lib/tiktok/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = async (req: Request, { params }: Params) => {
  if (!isTikTokEnabled()) {
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
