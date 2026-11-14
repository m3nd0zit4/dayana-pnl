import crypto from "crypto";
import type { GoogleService } from "@prisma/client";
import { SERVICE_SCOPES } from "./scopes";

/**
 * `state` firmado del consentimiento de Google, y la cookie PKCE que lo ata
 * al navegador que lo empezó.
 *
 * Google devuelve el navegador a una URL fija (`/api/admin/google/callback`),
 * así que lo único que dice a qué cuenta pertenece el código es el `state`. Va
 * firmado con HMAC-SHA256 para que nadie pueda fabricar uno que ate su propia
 * cuenta de Google a una fila nuestra, caduca en minutos y lleva el staff que
 * empezó el permiso para que solo esa persona lo pueda cerrar.
 *
 * Un `state` filtrado (historial, captura, logs) no basta para inyectar el
 * código de otra cuenta de Google: el callback exige además la cookie
 * `httpOnly` con el mismo `nonce` y el `code_verifier` PKCE, que solo tiene el
 * navegador que pulsó «Conectar», y la borra al usarla (un solo uso).
 *
 * Formato del state: `<payload base64url>.<firma base64url>`.
 */

export type GoogleOAuthState = {
  /** `GoogleAccount.id` que se está conectando. */
  accountId: string;
  /** Staff que pulsó «Conectar»; el callback exige que sea el mismo. */
  staffUserId: string;
  /**
   * Servicios pedidos a Google. Se guardan en la cuenta en el callback, y solo
   * los que Google concedió: marcar una casilla no cambia nada hasta entonces.
   */
  services: GoogleService[];
  /** Ata el state a la cookie PKCE de este navegador. */
  nonce: string;
  /** Ruta interna a la que volver al terminar (siempre empieza por `/`). */
  returnTo: string;
  /** Caducidad, en milisegundos desde epoch. */
  exp: number;
};

export const STATE_TTL_MS = 15 * 60 * 1000;
const KEY_INFO = "dayana-pnl:google-oauth-state:v1";
const KNOWN_SERVICES = new Set(Object.keys(SERVICE_SCOPES));

const stateKey = (): Buffer => {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET es obligatorio para firmar el permiso de Google.");
  }
  // Clave derivada, no el secreto tal cual: mismo criterio que secret-box.
  return Buffer.from(crypto.hkdfSync("sha256", secret, "", KEY_INFO, 32));
};

const sign = (payload: string): string =>
  crypto.createHmac("sha256", stateKey()).update(payload).digest("base64url");

const INTERNAL_BASE = "http://internal.invalid";

/** Caracteres de control, espacios o `\`: el parser de URL los quita o los cambia por `/`. */
const hasUnsafeChars = (value: string): boolean => {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || char === "\\" || /\s/u.test(char)) return true;
  }
  return false;
};

/**
 * Solo rutas internas: un `returnTo` externo sería una redirección abierta.
 *
 * Además de exigir `/` al principio se resuelve la ruta y se compara el
 * origen, porque `/\t/evil.com` pasa un `startsWith("//")` pero el parser de
 * URL quita el tabulador y lo deja en `//evil.com`.
 */
export const safeReturnPath = (value: unknown, fallback: string): string => {
  if (typeof value !== "string" || !value.startsWith("/") || hasUnsafeChars(value)) {
    return fallback;
  }
  try {
    const url = new URL(value, INTERNAL_BASE);
    return url.origin === INTERNAL_BASE ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
};

export const signOAuthState = (
  input: Omit<GoogleOAuthState, "exp">,
  now: number = Date.now()
): string => {
  const state: GoogleOAuthState = { ...input, exp: now + STATE_TTL_MS };
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
};

const isServiceList = (value: unknown): value is GoogleService[] =>
  Array.isArray(value) && value.every((s) => typeof s === "string" && KNOWN_SERVICES.has(s));

/** Devuelve el contenido si la firma es buena y no ha caducado; si no, `null`. */
export const verifyOAuthState = (
  raw: string | null | undefined,
  now: number = Date.now()
): GoogleOAuthState | null => {
  if (!raw) return null;
  const [payload, signature, extra] = raw.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(payload), "base64url");
  const given = Buffer.from(signature, "base64url");
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return null;
  }

  try {
    const state = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<GoogleOAuthState>;
    if (
      typeof state.accountId !== "string" ||
      typeof state.staffUserId !== "string" ||
      typeof state.nonce !== "string" ||
      !state.nonce ||
      !isServiceList(state.services) ||
      typeof state.exp !== "number" ||
      state.exp <= now
    ) {
      return null;
    }
    return {
      accountId: state.accountId,
      staffUserId: state.staffUserId,
      services: Array.from(new Set(state.services)),
      nonce: state.nonce,
      returnTo: safeReturnPath(state.returnTo, "/admin/ajustes/integraciones"),
      exp: state.exp,
    };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// PKCE + cookie de un solo uso
// ---------------------------------------------------------------------------

/** Cookie `httpOnly` con `<nonce>.<code_verifier>`, limitada a la ruta del callback. */
export const GOOGLE_OAUTH_COOKIE = "google_oauth_pkce";

export type GoogleOAuthPkce = {
  nonce: string;
  /** `code_verifier` (RFC 7636): 43 caracteres base64url. */
  verifier: string;
  /** `code_challenge` S256 del verifier. */
  challenge: string;
};

export const pkceChallenge = (verifier: string): string =>
  crypto.createHash("sha256").update(verifier).digest("base64url");

export const createOAuthPkce = (): GoogleOAuthPkce => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return {
    nonce: crypto.randomBytes(16).toString("base64url"),
    verifier,
    challenge: pkceChallenge(verifier),
  };
};

export const encodePkceCookie = (pkce: Pick<GoogleOAuthPkce, "nonce" | "verifier">): string =>
  `${pkce.nonce}.${pkce.verifier}`;

/**
 * El `code_verifier` de la cookie si su `nonce` es el del state; si no, `null`
 * (otra pestaña empezó otro permiso, la cookie caducó o el state no es de este
 * navegador).
 */
export const readPkceCookie = (
  raw: string | null | undefined,
  expectedNonce: string
): string | null => {
  if (!raw) return null;
  const [nonce, verifier, extra] = raw.split(".");
  if (!nonce || !verifier || extra !== undefined) return null;
  const given = Buffer.from(nonce, "utf8");
  const expected = Buffer.from(expectedNonce, "utf8");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }
  return verifier;
};
