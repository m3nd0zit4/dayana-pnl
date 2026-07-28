import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { isMetaConnectConfigured } from "@/lib/meta/config";
import { buildMetaAuthorizationUrl } from "@/lib/meta/oauth";
import {
  stateCookieName,
  STATE_COOKIE_MAX_AGE_S,
} from "@/lib/social/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Arranca el OAuth de Meta.
 *
 * OWNER solamente: enlazar la Página entrega permiso para leer y responder los
 * mensajes de la marca.
 */
export const GET = async () => {
  if (!isMetaConnectConfigured()) {
    return NextResponse.json({ error: "meta_not_configured" }, { status: 404 });
  }

  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const authorization = buildMetaAuthorizationUrl(staff.id, "x");
  if (!authorization) {
    return NextResponse.json({ error: "meta_not_configured" }, { status: 503 });
  }

  // El nonce en cookie httpOnly convierte el state de "firmado" en "de un solo
  // uso y atado a este navegador": sin ella, un state válido podría reutilizarse
  // dentro de su ventana de 10 minutos.
  (await cookies()).set(stateCookieName("meta"), authorization.nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin/social",
    maxAge: STATE_COOKIE_MAX_AGE_S,
  });

  return NextResponse.redirect(authorization.url);
};
