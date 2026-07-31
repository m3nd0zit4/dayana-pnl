import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth/staff-session";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  destinationPath,
  stateCookieName,
  type OAuthDest,
} from "@/lib/social/oauth-state";
import { resolveSocialPublishingEnabled } from "@/lib/tiktok/resolve-flags";
import {
  exchangeCodeForToken,
  persistAccount,
  verifyState,
} from "@/lib/tiktok/oauth";
import { fetchUserInfo } from "@/lib/tiktok/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vuelta del OAuth de TikTok.
 *
 * Redirige siempre con un código legible; nunca JSON, porque aquí llega un
 * navegador. El destino es un carácter firmado resuelto contra un mapa fijo, no
 * una URL de la petición.
 */
const back = (req: Request, dest: OAuthDest, tiktok: string) =>
  NextResponse.redirect(
    new URL(`${destinationPath(dest)}?tiktok=${tiktok}`, req.url)
  );

export const GET = async (req: Request) => {
  if (!(await resolveSocialPublishingEnabled())) {
    return NextResponse.json({ error: "tiktok_disabled" }, { status: 404 });
  }

  const url = new URL(req.url);
  const jar = await cookies();
  const nonceCookie = jar.get(stateCookieName("tiktok"))?.value;
  jar.delete(stateCookieName("tiktok"));

  const verified = verifyState(url.searchParams.get("state") ?? "");
  if (!verified) return back(req, "c", "bad_state");

  if (!nonceCookie || nonceCookie !== verified.nonce) {
    return back(req, verified.dest, "bad_state");
  }

  const staff = await getStaffSession();
  if (!staff || staff.id !== verified.staffUserId || staff.role !== "OWNER") {
    return back(req, verified.dest, "bad_state");
  }

  // El motivo que devuelve TikTok no se propaga a la URL: la pantalla solo
  // sabe leer códigos de un mapa fijo, y reenviar texto del proveedor sería
  // meter una cadena ajena en la query sin necesidad.
  if (url.searchParams.get("error")) return back(req, verified.dest, "denied");

  const code = url.searchParams.get("code");
  if (!code) return back(req, verified.dest, "invalid");

  try {
    const token = await exchangeCodeForToken(code);

    // El perfil es opcional: si falla, la cuenta queda conectada igual y solo
    // se pierde el nombre bonito en la UI.
    let profile: { displayName?: string; username?: string; avatarUrl?: string } = {};
    try {
      const info = await fetchUserInfo(token.access_token);
      profile = {
        displayName: info.user.display_name,
        username: info.user.username,
        avatarUrl: info.user.avatar_url,
      };
    } catch {
      /* opcional */
    }

    const account = await persistAccount(token, staff.id, profile);

    fireAuditLog({
      staffUserId: staff.id,
      action: "SOCIAL_ACCOUNT_CONNECTED",
      entityType: "SocialAccount",
      entityId: account.id,
      changes: { provider: "TIKTOK", username: account.username },
    });

    return back(req, verified.dest, "connected");
  } catch (e) {
    console.error("[tiktok callback]", e);
    return back(req, verified.dest, "error");
  }
};
