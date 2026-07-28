import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth/staff-session";
import { fireAuditLog } from "@/lib/crm/audit";
import { saveWebhookState } from "@/lib/crm/social-accounts";
import { openSecret } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db";
import { isMetaConnectConfigured } from "@/lib/meta/config";
import { completeMetaConnection, verifyMetaState } from "@/lib/meta/oauth";
import { subscribePageWebhooks } from "@/lib/meta/subscriptions";
import {
  destinationPath,
  stateCookieName,
  type OAuthDest,
} from "@/lib/social/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vuelta del OAuth de Meta.
 *
 * Siempre redirige con un código legible en la query; nunca devuelve JSON,
 * porque aquí llega un navegador. El destino sale de un mapa fijo indexado por
 * un carácter que viaja **dentro** de la firma, así que no hay forma de que un
 * parámetro de la petición se convierta en URL de redirección.
 */
const back = (req: Request, dest: OAuthDest, meta: string) =>
  NextResponse.redirect(
    new URL(`${destinationPath(dest)}?meta=${meta}`, req.url)
  );

export const GET = async (req: Request) => {
  if (!isMetaConnectConfigured()) {
    return NextResponse.json({ error: "meta_not_configured" }, { status: 404 });
  }

  const url = new URL(req.url);
  const jar = await cookies();
  const nonceCookie = jar.get(stateCookieName("meta"))?.value;
  jar.delete(stateCookieName("meta"));

  const verified = verifyMetaState(url.searchParams.get("state"));
  if (!verified) return back(req, "x", "bad_state");

  // Un solo uso: el nonce firmado tiene que coincidir con el de la cookie.
  if (!nonceCookie || nonceCookie !== verified.nonce) {
    return back(req, verified.dest, "bad_state");
  }

  // Defensa en profundidad: el state ya dice quién lo pidió, pero si la sesión
  // del navegador no es esa persona (o ya no es OWNER), no se enlaza nada.
  const staff = await getStaffSession();
  if (!staff || staff.id !== verified.staffUserId || staff.role !== "OWNER") {
    return back(req, verified.dest, "bad_state");
  }

  if (url.searchParams.get("error")) {
    return back(req, verified.dest, "denied");
  }

  const code = url.searchParams.get("code");
  if (!code) return back(req, verified.dest, "invalid");

  try {
    const result = await completeMetaConnection(code, staff.id);

    if (result.outcome === "no_page") return back(req, verified.dest, "no_page");
    if (result.outcome === "many_pages") {
      return back(req, verified.dest, "many_pages");
    }

    fireAuditLog({
      staffUserId: staff.id,
      action: "SOCIAL_ACCOUNT_CONNECTED",
      entityType: "SocialAccount",
      entityId: result.pageId,
      changes: {
        provider: "META",
        pageName: result.pageName,
        instagramId: result.instagramId,
      },
    });

    // Suscribir la Página es lo que quita el paso manual de la consola. Si
    // falla, la conexión NO se pierde: se guarda el motivo y la pantalla ofrece
    // reintentar. Tirar un token recién autorizado porque una llamada
    // secundaria falló es el peor resultado posible.
    const account = await prisma.socialAccount.findFirst({
      where: { provider: "FACEBOOK", externalId: result.pageId },
      select: { accessTokenEnc: true },
    });

    if (!account?.accessTokenEnc) {
      return back(req, verified.dest, "connected_no_webhook");
    }

    const webhook = await subscribePageWebhooks(
      result.pageId,
      openSecret(account.accessTokenEnc)
    );
    await saveWebhookState(result.pageId, webhook);

    return back(
      req,
      verified.dest,
      webhook.subscribed ? "connected" : "connected_no_webhook"
    );
  } catch (e) {
    console.error("[meta callback]", e);
    return back(req, verified.dest, "error");
  }
};
