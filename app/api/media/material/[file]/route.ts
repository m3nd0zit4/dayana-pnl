import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";

/**
 * El material de una palabra clave, servido desde el store privado de Blob.
 *
 * Público a propósito: es lo que se prometió en un video abierto, y pedir
 * sesión para abrirlo sería pedirle cuenta a quien acaba de conocerte. Lo que
 * sí se cierra es la forma del nombre: solo los que genera la subida, para que
 * esta ruta no sirva para leer cualquier otro archivo del store.
 */

const FILE_RE = /^\d{10,16}-[a-z0-9]{8}\.(pdf|jpg|png|mp3|m4a)$/;

const CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  const match = FILE_RE.exec(file);
  if (!match) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const result = await get(`material/${file}`, { access: "private" }).catch(
    () => null
  );
  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": CONTENT_TYPE[match[1]],
      // El nombre es único y nunca se reescribe.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": "inline",
    },
  });
}
