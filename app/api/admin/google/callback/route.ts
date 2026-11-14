import { NextResponse, type NextRequest } from "next/server";
import { withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  activateGoogleAccount,
  getGoogleAccount,
} from "@/lib/crm/google-accounts";
import {
  completeAccountAuthorization,
  forgetAccountToken,
  GoogleNoRefreshTokenError,
  SCOPES_MISSING_MESSAGE,
  servicesNotGrantedMessage,
} from "@/lib/google/connect";
import { clearGoogleOAuthCookie } from "@/lib/google/oauth-cookie";
import {
  GOOGLE_OAUTH_COOKIE,
  readPkceCookie,
  safeReturnPath,
  verifyOAuthState,
} from "@/lib/google/oauth-state";
import { splitGrantedServices } from "@/lib/google/scopes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vuelta del consentimiento de Google (`redirect_uri` fija, registrada en el
 * cliente OAuth de Google Cloud).
 *
 * Aquí llega un navegador, no un cliente de API, así que siempre se redirige a
 * la pantalla de ajustes con un parámetro legible — mismo criterio que el
 * callback de TikTok.
 *
 * La cuenta sale del `state` firmado (HMAC, 15 min, atado al staff que empezó),
 * nunca de un parámetro suelto, y el `state` solo vale con la cookie PKCE del
 * navegador que lo pidió (mismo `nonce`; su `code_verifier` va al intercambio
 * del código). La cookie se borra en toda respuesta: un solo uso. Que hubo
 * permiso lo prueba el intercambio del `code` por un refresh token, no lo que
 * diga la URL.
 */
const FALLBACK_RETURN = "/admin/ajustes/integraciones";

const back = (req: NextRequest, returnTo: string, params: Record<string, string>) => {
  const origin = new URL(req.url).origin;
  let url = new URL(safeReturnPath(returnTo, FALLBACK_RETURN), req.url);
  // Segunda barrera contra una redirección abierta: nunca fuera de este sitio.
  if (url.origin !== origin) url = new URL(FALLBACK_RETURN, req.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.hash = "google";
  return clearGoogleOAuthCookie(NextResponse.redirect(url));
};

export const GET = withStaff("owner", async ({ req, staff }) => {
  const query = new URL(req.url).searchParams;
  const state = verifyOAuthState(query.get("state"));
  if (!state || state.staffUserId !== staff.id) {
    return back(req, FALLBACK_RETURN, { google: "invalid" });
  }

  const account = await getGoogleAccount(state.accountId);
  if (!account) return back(req, state.returnTo, { google: "not_found" });

  const error = query.get("error");
  if (error) {
    // access_denied = la persona pulsó «Cancelar» en Google. Nada que guardar:
    // los servicios añadidos no se guardaron al pedirlos, así que la cuenta
    // sigue como estaba.
    if (error !== "access_denied") console.error("[google callback] error de Google:", error);
    return back(req, state.returnTo, { google: "denied" });
  }

  const code = query.get("code");
  if (!code) return back(req, state.returnTo, { google: "invalid" });

  // El state solo vale en el navegador que lo pidió (cookie con su nonce).
  const codeVerifier = readPkceCookie(req.cookies.get(GOOGLE_OAUTH_COOKIE)?.value, state.nonce);
  if (!codeVerifier) return back(req, state.returnTo, { google: "invalid" });

  try {
    const completed = await completeAccountAuthorization(code, codeVerifier);
    const { granted, missing } = splitGrantedServices(state.services, completed.grantedScopes);

    if (granted.length === 0 && account.isActive) {
      // Google no dio ninguno de los servicios pedidos: se descarta este
      // permiso y la cuenta sigue funcionando con el que ya tenía.
      fireAuditLog({
        staffUserId: staff.id,
        action: "GOOGLE_ACCOUNT_CONNECT_FAILED",
        entityType: "GoogleAccount",
        entityId: account.id,
        changes: { reason: "missing_scopes", requested: state.services },
      });
      return back(req, state.returnTo, { google: "missing_scopes" });
    }

    const activated = await activateGoogleAccount(account.id, {
      identity: completed.identity,
      refreshTokenEnc: completed.refreshTokenEnc,
      grantedScopes: completed.grantedScopes,
      // Solo lo que Google concedió. Si no concedió nada (cuenta nueva o ya
      // caída) se guardan los pedidos, para que «Volver a conectar» los pida.
      services: granted.length > 0 ? granted : state.services,
      isActive: granted.length > 0,
      lastError:
        granted.length === 0
          ? SCOPES_MISSING_MESSAGE
          : missing.length > 0
            ? servicesNotGrantedMessage(missing)
            : null,
    });
    forgetAccountToken(account.id);

    fireAuditLog({
      staffUserId: staff.id,
      action: "GOOGLE_ACCOUNT_CONNECTED",
      entityType: "GoogleAccount",
      entityId: activated.id,
      changes: {
        email: activated.email,
        services: activated.services,
        grantedScopes: completed.grantedScopes,
        ...(missing.length > 0 ? { missingServices: missing } : {}),
      },
    });

    return back(req, state.returnTo, {
      google:
        granted.length === 0 ? "missing_scopes" : missing.length > 0 ? "partial_scopes" : "connected",
    });
  } catch (err) {
    console.error("[google callback]", err);
    return back(req, state.returnTo, {
      google: err instanceof GoogleNoRefreshTokenError ? "no_refresh" : "denied",
    });
  }
});
