import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { resolveAdminStaff } from "@/lib/auth/api-staff";
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

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
};
