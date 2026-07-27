import crypto from "crypto";

/**
 * Cifrado simétrico para secretos que deben vivir en la base de datos.
 *
 * Los tokens de OAuth de las redes sociales no pueden ir en variables de
 * entorno: son por cuenta conectada y se renuevan solos. Pero un token de
 * TikTok en claro en Neon es una credencial de publicación en la cuenta real de
 * Dayana, así que se guarda cifrado.
 *
 * AES-256-GCM: cifra y autentica a la vez, de modo que un texto manipulado
 * falla al descifrar en vez de devolver basura silenciosamente.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // el tamaño recomendado para GCM
const KEY_INFO = "dayana-pnl:secret-box:v1";

/**
 * Deriva la clave de `AUTH_SECRET`.
 *
 * Se usa HKDF y no el secreto tal cual para no reutilizar exactamente el mismo
 * material que NextAuth: si un día se filtra uno de los dos usos, el otro no
 * queda comprometido de forma trivial.
 */
const deriveKey = (): Buffer => {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "AUTH_SECRET es obligatorio para cifrar secretos en la base de datos."
    );
  }
  return Buffer.from(
    crypto.hkdfSync("sha256", secret, "", KEY_INFO, 32)
  );
};

/** Formato: `v1.<iv base64url>.<tag base64url>.<ciphertext base64url>`. */
export const sealSecret = (plaintext: string): string => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

export const openSecret = (sealed: string): string => {
  const [version, rawIv, rawTag, rawData] = sealed.split(".");
  if (version !== "v1" || !rawIv || !rawTag || !rawData) {
    throw new Error("Secreto con formato desconocido.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    deriveKey(),
    Buffer.from(rawIv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(rawTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(rawData, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

/** Para logs y UI: nunca mostrar el token, solo confirmar que existe. */
export const secretFingerprint = (plaintext: string): string =>
  crypto.createHash("sha256").update(plaintext).digest("hex").slice(0, 8);
