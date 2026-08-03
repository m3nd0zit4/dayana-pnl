import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { verifyAndParseMuxWebhook } from "@/lib/webhooks/verify";
import {
  handleMuxAssetCreated,
  handleMuxAssetErrored,
  handleMuxAssetReady,
} from "@/lib/lms/course-admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Firma sobre el cuerpo crudo — se lee una sola vez, igual que Meta/Resend.
  const rawBody = await req.text();

  const event = await verifyAndParseMuxWebhook(req, rawBody);
  if (!event) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  switch (event.type) {
    case "video.upload.asset_created": {
      const uploadId = event.data.id;
      const assetId = event.data.asset_id;
      if (uploadId && assetId) {
        await handleMuxAssetCreated(uploadId, assetId);
      }
      break;
    }
    case "video.asset.ready": {
      const assetId = event.data.id;
      const playbackId = event.data.playback_ids?.[0]?.id;
      const durationSec =
        typeof event.data.duration === "number"
          ? Math.round(event.data.duration)
          : null;
      if (assetId && playbackId) {
        await handleMuxAssetReady(assetId, playbackId, durationSec);
      }
      break;
    }
    case "video.asset.errored": {
      const assetId = event.data.id;
      const message = event.data.errors?.messages?.join("; ") ?? null;
      if (assetId) {
        await handleMuxAssetErrored(assetId, message);

        const cls = await prisma.liveClassSession.findFirst({
          where: { muxAssetId: assetId },
          select: { id: true, title: true, moduleId: true },
        });
        if (cls) {
          fireNotification({
            eventType: "SYSTEM_ALERT",
            title: "Falló el procesamiento de una grabación",
            body: `"${cls.title}" — ${message ?? "Mux no pudo procesar el video."}`,
            href: cls.moduleId
              ? `/admin/curso/modulos/${cls.moduleId}`
              : "/admin/curso/modulos",
            entityType: "LiveClassSession",
            entityId: cls.id,
            metadata: { assetId, message },
            staff: "ALL",
          });
        }
      }
      break;
    }
    default:
      // Cualquier otro tipo de evento se ignora — no interesa a este flujo.
      break;
  }

  return NextResponse.json({ ok: true });
}
