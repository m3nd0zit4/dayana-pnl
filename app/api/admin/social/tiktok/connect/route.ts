import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import {
  stateCookieName,
  STATE_COOKIE_MAX_AGE_S,
  type OAuthDest,
} from "@/lib/social/oauth-state";
import { resolveSocialPublishingEnabled } from "@/lib/tiktok/resolve-flags";
import { buildAuthorizationUrl } from "@/lib/tiktok/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Arranca el OAuth de TikTok.
 *
 * OWNER solamente: conectar una cuenta entrega permiso de publicación sobre el
 * perfil real, así que no es una acción de operador.
 */
export const GET = async (req: Request) => {
  if (!(await resolveSocialPublishingEnabled())) {
    return NextResponse.json({ error: "tiktok_disabled" }, { status: 404 });
  }

  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  // `dest` decide a qué pantalla se vuelve. Solo se acepta el carácter, que
  // luego viaja firmado; nunca una URL de la petición.
  const requested = new URL(req.url).searchParams.get("dest");
  const dest: OAuthDest = requested === "x" ? "x" : "c";

  const authorization = buildAuthorizationUrl(staff.id, dest);
  if (!authorization) {
    return NextResponse.json({ error: "tiktok_not_configured" }, { status: 503 });
  }

  (await cookies()).set(stateCookieName("tiktok"), authorization.nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin/social",
    maxAge: STATE_COOKIE_MAX_AGE_S,
  });

  return NextResponse.redirect(authorization.url);
};
