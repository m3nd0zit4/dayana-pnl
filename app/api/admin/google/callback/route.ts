import { NextResponse } from "next/server";
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
} from "@/lib/google/connect";
import { verifyOAuthState } from "@/lib/google/oauth-state";
import { ON_REQUEST_ONLY, servicesMissingScopes } from "@/lib/google/scopes";

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
 * nunca de un parámetro suelto. Que hubo permiso lo prueba el intercambio del
 * `code` por un refresh token, no lo que diga la URL.
 */
const back = (req: Request, returnTo: string, params: Record<string, string>) => {
  const url = new URL(returnTo, req.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.hash = "google";
  return NextResponse.redirect(url);
};

const FALLBACK_RETURN = "/admin/ajustes/integraciones";

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
    // access_denied = la persona pulsó «Cancelar» en Google. Nada que guardar.
    if (error !== "access_denied") console.error("[google callback] error de Google:", error);
    return back(req, state.returnTo, { google: "denied" });
  }

  const code = query.get("code");
  if (!code) return back(req, state.returnTo, { google: "invalid" });

  try {
    const completed = await completeAccountAuthorization(code);
    const missing = servicesMissingScopes(account.services, completed.grantedScopes).filter(
      (s) => !ON_REQUEST_ONLY.includes(s)
    );
    const activated = await activateGoogleAccount(account.id, {
      identity: completed.identity,
      refreshTokenEnc: completed.refreshTokenEnc,
      grantedScopes: completed.grantedScopes,
      missingReason: missing.length > 0 ? SCOPES_MISSING_MESSAGE : null,
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
      google: missing.length > 0 ? "missing_scopes" : "connected",
    });
  } catch (err) {
    console.error("[google callback]", err);
    return back(req, state.returnTo, {
      google: err instanceof GoogleNoRefreshTokenError ? "no_refresh" : "denied",
    });
  }
});
