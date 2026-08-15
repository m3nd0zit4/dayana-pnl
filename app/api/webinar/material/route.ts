import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getFreeWebinar } from "@/lib/crm/free-webinar";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga pública del material del webinar.
 *
 * El blob es privado, así que se sirve por aquí en vez de exponer su URL: eso
 * mantiene la descarga atada al estado del webinar y no a un enlace eterno que
 * siga funcionando cuando la edición ya no existe.
 *
 * Se sirve solo mientras la edición está viva y no ha terminado, la misma
 * puerta que la landing. Una edición archivada conserva sus columnas, pero
 * `getFreeWebinar` resuelve por slug `gratuito`, así que su material deja de
 * ser alcanzable en cuanto se archiva.
 */
export async function GET() {
  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const webinar = await getFreeWebinar();
  if (
    !webinar?.materialUrl ||
    !webinar.isActive ||
    !webinar.startsAt ||
    webinar.endedAt
  ) {
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
      // Sin caché compartida: la descarga sigue el estado del webinar, y una
      // copia intermedia lo desacoplaría.
      "Cache-Control": "private, no-store",
    },
  });
}
