import crypto from "crypto";

/**
 * `state` firmado, compartido por todos los OAuth de redes sociales.
 *
 * Tres propiedades que el state tiene que dar, y por qué:
 *
 * 1. **Autenticidad** — va firmado con HMAC-SHA256 sobre `AUTH_SECRET`, así que
 *    nadie puede fabricar uno.
 * 2. **Aislamiento entre proveedores** — el `purpose` va dentro de la firma, de
 *    modo que un state emitido para TikTok se rechaza en el callback de Meta.
 * 3. **Destino cerrado** — el sitio al que se vuelve es UN carácter dentro de la
 *    firma, que se resuelve contra un mapa fijo del servidor. Nunca se
 *    construye una URL con algo que venga de la petición, así que no hay
 *    superficie de redirección abierta.
 */

export type OAuthPurpose = "tiktok" | "meta";

/**
 * Destinos permitidos. El valor jamás se convierte en URL a partir de la
 * entrada: la clave es un índice en esta constante.
 */
const DESTINATIONS = {
  c: "/admin/contenido",
  x: "/admin/ajustes/conexiones",
} as const;

export type OAuthDest = keyof typeof DESTINATIONS;

export const destinationPath = (dest: OAuthDest): string =>
  DESTINATIONS[dest] ?? DESTINATIONS.x;

/** Nombre de la cookie que ata el state a este navegador. */
export const stateCookieName = (purpose: OAuthPurpose): string =>
  `social_oauth_${purpose}`;

export const STATE_COOKIE_MAX_AGE_S = 600;

/**
 * Clave de firma.
 *
 * Lanza si falta `AUTH_SECRET` en vez de caer a "": con una clave vacía, firma y
 * verificación coinciden siempre y **cualquier state falsificado se acepta**, en
 * silencio y solo en el despliegue mal configurado. Un arranque roto se ve; un
 * OAuth que acepta todo, no.
 */
const signingKey = (): string => {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "AUTH_SECRET es obligatorio para firmar el state de OAuth."
    );
  }
  return secret;
};

const sign = (payload: string): string =>
  crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export type IssuedState = { state: string; nonce: string };

export const issueOAuthState = (
  purpose: OAuthPurpose,
  staffUserId: string,
  dest: OAuthDest
): IssuedState => {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = `${purpose}.${dest}.${staffUserId}.${Date.now()}.${nonce}`;
  return { state: `${payload}.${sign(payload)}`, nonce };
};

export type VerifiedState = {
  staffUserId: string;
  nonce: string;
  dest: OAuthDest;
};

export const verifyOAuthState = (
  purpose: OAuthPurpose,
  state: string | null | undefined
): VerifiedState | null => {
  if (!state) return null;

  const parts = state.split(".");
  if (parts.length !== 6) return null;

  const [statePurpose, dest, staffUserId, issuedAt, nonce, signature] = parts;

  // El propósito va firmado, así que esto no es solo una comprobación de forma:
  // impide reutilizar en Meta un state emitido para TikTok.
  if (statePurpose !== purpose) return null;
  if (!(dest in DESTINATIONS)) return null;

  const expected = sign(
    `${statePurpose}.${dest}.${staffUserId}.${issuedAt}.${nonce}`
  );

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > STATE_MAX_AGE_MS) return null;

  return { staffUserId, nonce, dest: dest as OAuthDest };
};
