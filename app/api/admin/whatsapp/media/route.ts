import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { parseRange } from "@/lib/http/range";
import { blobNotConfiguredResponse, isBlobConfigured } from "@/lib/storage/blob";

export const runtime = "nodejs";

/**
 * Fotos, audios, videos, stickers y documentos de los chats, servidos desde el
 * store privado de Blob solo a quien tiene sesión en el CRM. Son datos de
 * clientes: no pueden tener una URL pública.
 *
 * Solo lee dentro de `inbox/` (lo que guarda la bandeja al recibir y al
 * enviar): la ruta no sirve para leer otros archivos del store. Cada archivo
 * tiene un nombre único que nunca se reescribe, así que el navegador lo guarda.
 *
 * Responde por partes (`Range`): Safari en iPhone no reproduce un audio ni un
 * video si el servidor no lo acepta, y en el celular «no cargaban».
 */

const PATH_RE = /^inbox\/(?:outbound\/)?[A-Za-z0-9-]+\.[a-z0-9]{2,5}$/;

export const GET = async (req: Request) => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!PATH_RE.test(path)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isBlobConfigured()) return blobNotConfiguredResponse();

  const result = await get(path, { access: "private" }).catch(() => null);
  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const contentType = result.blob.contentType ?? "application/octet-stream";
  // Los adjuntos de WhatsApp son pequeños (fotos, notas de voz, videos de
  // pocos MB): se leen enteros para poder responder por partes.
  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  const size = bytes.length;
  const common = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };

  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      return new NextResponse(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${size}` } });
    }
    const [start, end] = range;
    return new NextResponse(bytes.subarray(start, end + 1), {
      status: 206,
      headers: {
        ...common,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new NextResponse(bytes, { headers: { ...common, "Content-Length": String(size) } });
};
