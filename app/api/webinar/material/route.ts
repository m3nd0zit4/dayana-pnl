import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { isFreeEventMaterialDownloadable } from "@/lib/crm/free-events";
import { getFreeEventById, getOpenFreeEvent } from "@/lib/crm/free-webinar";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga pública del material de un evento gratuito.
 *
 * El blob es privado, así que se sirve por aquí en vez de exponer su URL: eso
 * mantiene la descarga atada al estado del evento y no a un enlace eterno que
 * siga funcionando cuando el evento ya pasó.
 *
 * `?evento=<id>` sirve el de ese evento mientras esté en pie (publicado o con
 * inscripciones cerradas, sin terminar): publicar el siguiente no deja sin
 * material a quien ya se inscribió en este. Sin parámetro —los correos de
 * antes— el del evento abierto.
 */
export async function GET(req: Request) {
  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const eventId = new URL(req.url).searchParams.get("evento")?.trim().slice(0, 64);
  const webinar = eventId ? await getFreeEventById(eventId) : await getOpenFreeEvent();
  if (!webinar?.materialUrl || !isFreeEventMaterialDownloadable(webinar)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await get(webinar.materialUrl, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const filename = (webinar.materialFileName ?? "material.pdf").replace(
    /"/g,
    ""
  );

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": webinar.materialMimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Sin caché compartida: la descarga sigue el estado del evento, y una
      // copia intermedia lo desacoplaría.
      "Cache-Control": "private, no-store",
    },
  });
}
