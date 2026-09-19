import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";

/**
 * Portada de un producto, servida desde el store privado.
 *
 * El store de Blob está configurado sin acceso público, así que subir la
 * portada como pública fallaba («Cannot use public access on a private store»)
 * y el CRM decía solo «No se pudo subir la portada». Se sube privada y se
 * sirve por aquí.
 *
 * Solo acepta nombres con la forma exacta que genera la subida
 * (`products/covers/<marca>-<sufijo>.<ext>`): la ruta no puede usarse para
 * leer otros archivos del store. El nombre es único y nunca se reescribe, así
 * que la respuesta se cachea un año en el CDN y no cuesta una función por
 * cada tarjeta que se pinta.
 */

const FILE_RE = /^\d{10,16}-[a-z0-9]{8}\.(jpg|png|webp|avif)$/;

const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const match = FILE_RE.exec(file);
  if (!match) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const result = await get(`products/covers/${file}`, { access: "private" }).catch(() => null);
  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": CONTENT_TYPE[match[1]],
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
