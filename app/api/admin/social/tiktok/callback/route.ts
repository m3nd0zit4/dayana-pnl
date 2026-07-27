import { NextResponse } from "next/server";
import { fireAuditLog } from "@/lib/crm/audit";
import { isTikTokEnabled } from "@/lib/tiktok/client";
import {
  exchangeCodeForToken,
  persistAccount,
  verifyState,
} from "@/lib/tiktok/oauth";
import { fetchUserInfo } from "@/lib/tiktok/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (req: Request, params: Record<string, string>) =>
  NextResponse.redirect(
    new URL(`/admin/contenido?${new URLSearchParams(params)}`, req.url)
  );

/**
 * Vuelta del OAuth de TikTok.
 *
 * Siempre redirige a la UI con un parámetro legible en vez de devolver JSON:
 * aquí llega un navegador, no un cliente de API.
 */
export const GET = async (req: Request) => {
  if (!isTikTokEnabled()) {
    return NextResponse.json({ error: "tiktok_disabled" }, { status: 404 });
  }

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) {
    return back(req, { tiktok: "denied", reason: error });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back(req, { tiktok: "invalid" });

  // El state va firmado con AUTH_SECRET; sin esto, cualquiera podría inducir
  // una conexión con un código ajeno.
  const verified = verifyState(state);
  if (!verified) return back(req, { tiktok: "bad_state" });

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

    const account = await persistAccount(token, verified.staffUserId, profile);

    fireAuditLog({
      staffUserId: verified.staffUserId,
      action: "SOCIAL_ACCOUNT_CONNECTED",
      entityType: "SocialAccount",
      entityId: account.id,
      changes: { provider: "TIKTOK", username: account.username },
    });

    return back(req, { tiktok: "connected" });
  } catch (e) {
    console.error("[tiktok callback]", e);
    return back(req, { tiktok: "error" });
  }
};
