import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { isTikTokEnabled } from "@/lib/tiktok/client";
import { buildAuthorizationUrl } from "@/lib/tiktok/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Arranca el OAuth de TikTok.
 *
 * OWNER solamente: conectar una cuenta entrega permiso de publicación sobre el
 * perfil real, así que no es una acción de operador.
 */
export const GET = async () => {
  if (!isTikTokEnabled()) {
    return NextResponse.json({ error: "tiktok_disabled" }, { status: 404 });
  }

  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const authorization = buildAuthorizationUrl(staff.id);
  if (!authorization) {
    return NextResponse.json({ error: "tiktok_not_configured" }, { status: 503 });
  }

  return NextResponse.redirect(authorization.url);
};
