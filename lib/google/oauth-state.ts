import crypto from "crypto";

/**
 * `state` firmado del consentimiento de Google.
 *
 * Google devuelve el navegador a una URL fija (`/api/admin/google/callback`),
 * así que lo único que dice a qué cuenta pertenece el código es el `state`. Va
 * firmado con HMAC-SHA256 para que nadie pueda fabricar uno que ate su propia
 * cuenta de Google a una fila nuestra, caduca en minutos y lleva el staff que
 * empezó el permiso para que solo esa persona lo pueda cerrar.
 *
 * Formato: `<payload base64url>.<firma base64url>`.
 */

export type GoogleOAuthState = {
  /** `GoogleAccount.id` que se está conectando. */
  accountId: string;
  /** Staff que pulsó «Conectar»; el callback exige que sea el mismo. */
  staffUserId: string;
  /** Ruta interna a la que volver al terminar (siempre empieza por `/`). */
  returnTo: string;
  /** Caducidad, en milisegundos desde epoch. */
  exp: number;
};

export const STATE_TTL_MS = 15 * 60 * 1000;
const KEY_INFO = "dayana-pnl:google-oauth-state:v1";

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

/** Solo rutas internas: un `returnTo` externo sería una redirección abierta. */
export const safeReturnPath = (value: unknown, fallback: string): string =>
  typeof value === "string" &&
  value.startsWith("/") &&
  !value.startsWith("//") &&
  !value.includes("\\")
    ? value
    : fallback;

export const signOAuthState = (
  input: Omit<GoogleOAuthState, "exp">,
  now: number = Date.now()
): string => {
  const state: GoogleOAuthState = { ...input, exp: now + STATE_TTL_MS };
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
};

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
      typeof state.exp !== "number" ||
      state.exp <= now
    ) {
      return null;
    }
    return {
      accountId: state.accountId,
      staffUserId: state.staffUserId,
      returnTo: safeReturnPath(state.returnTo, "/admin/ajustes/integraciones"),
      exp: state.exp,
    };
  } catch {
    return null;
  }
};
