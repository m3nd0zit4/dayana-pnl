import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { verifyAndParseMuxWebhook } from "@/lib/webhooks/verify";
import {
  handleMuxAssetCreated,
  handleMuxAssetErrored,
  handleMuxAssetReady,
} from "@/lib/lms/course-admin";
import {
  handleWebinarMuxAssetCreated,
  handleWebinarMuxAssetErrored,
  handleWebinarMuxAssetReady,
} from "@/lib/crm/free-webinar";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Firma sobre el cuerpo crudo — se lee una sola vez, igual que Meta/Resend.
  const rawBody = await req.text();

  const event = await verifyAndParseMuxWebhook(req, rawBody);
  if (!event) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  // Dos consumidores comparten esta cuenta de Mux: las grabaciones del curso y
  // el vídeo promocional del webinar. Los ids de subida y de asset son únicos,
  // así que basta con intentar primero el curso y caer al webinar cuando el
  // `updateMany` no tocó ninguna fila — no hace falta leer `passthrough`.
  switch (event.type) {
    case "video.upload.asset_created": {
      const uploadId = event.data.id;
      const assetId = event.data.asset_id;
      if (uploadId && assetId) {
        const matched = await handleMuxAssetCreated(uploadId, assetId);
        if (matched === 0) {
          await handleWebinarMuxAssetCreated(uploadId, assetId);
        }
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
        const matched = await handleMuxAssetReady(
          assetId,
          playbackId,
          durationSec
        );
        if (matched === 0) {
          await handleWebinarMuxAssetReady(assetId, playbackId, durationSec);
        }
      }
      break;
    }
    case "video.asset.errored": {
      const assetId = event.data.id;
      const message = event.data.errors?.messages?.join("; ") ?? null;
      if (assetId) {
        const matched = await handleMuxAssetErrored(assetId, message);

        const cls = matched
          ? await prisma.liveClassSession.findFirst({
              where: { muxAssetId: assetId },
              select: { id: true, title: true, moduleId: true },
            })
          : null;
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
          break;
        }

        const webinarMatched = await handleWebinarMuxAssetErrored(
          assetId,
          message
        );
        if (webinarMatched > 0) {
          const webinar = await prisma.freeWebinar.findFirst({
            where: { muxAssetId: assetId },
            select: { id: true },
          });
          if (webinar) {
            fireNotification({
              eventType: "SYSTEM_ALERT",
              title: "Falló el procesamiento del vídeo del webinar",
              body: message ?? "Mux no pudo procesar el vídeo promocional.",
              href: "/admin/webinar",
              entityType: "FreeWebinar",
              entityId: webinar.id,
              metadata: { assetId, message },
              staff: "ALL",
            });
          }
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
