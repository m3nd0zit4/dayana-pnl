import type { NextResponse } from "next/server";
import { GOOGLE_CALLBACK_PATH } from "./oauth";
import { GOOGLE_OAUTH_COOKIE, STATE_TTL_MS } from "./oauth-state";

/**
 * Cookie PKCE del consentimiento de Google (ver `oauth-state.ts`).
 *
 * `httpOnly`, `SameSite=Lax` (la vuelta de Google es una navegación GET de
 * nivel superior, así que llega) y limitada a la ruta del callback: no viaja
 * con ninguna otra petición. Dura lo mismo que el `state`.
 */
const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: GOOGLE_CALLBACK_PATH,
  maxAge,
});

export const setGoogleOAuthCookie = (res: NextResponse, value: string): NextResponse => {
  res.cookies.set(GOOGLE_OAUTH_COOKIE, value, cookieOptions(Math.floor(STATE_TTL_MS / 1000)));
  return res;
};

/** El callback la borra siempre: cada `state` sirve una sola vez. */
export const clearGoogleOAuthCookie = (res: NextResponse): NextResponse => {
  res.cookies.set(GOOGLE_OAUTH_COOKIE, "", cookieOptions(0));
  return res;
};
