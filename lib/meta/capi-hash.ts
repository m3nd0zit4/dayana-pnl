import crypto from "crypto";

/**
 * Normalización + hash para el `user_data` de la Conversions API.
 *
 * Meta exige SHA-256 en hexadecimal minúscula sobre el valor YA normalizado.
 * Normalizar mal no da error: da un hash que simplemente no casa con nadie, y
 * la campaña parece no convertir. Por eso cada regla sigue la especificación
 * de Meta al pie de la letra en vez de "lo que suele funcionar".
 */

const sha256 = (value: string): string =>
  crypto.createHash("sha256").update(value, "utf8").digest("hex");

/** Correo: recortado y en minúscula. */
export const hashEmail = (email: string | null | undefined): string | null => {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  return sha256(normalized);
};

/**
 * Teléfonos de relleno que el checkout usa como clave temporal
 * (`+pending…`, `+google…`, `+signup…`). No son marcables: hashearlos mandaría
 * ruido a Meta y empeoraría la calidad de match, así que se descartan.
 *
 * Se replican los prefijos en vez de importar `isRealContactPhone` de
 * `lib/crm/checkout-session-contact.ts` porque ese módulo arrastra `@/auth`
 * (next-auth), y este código es alcanzable desde el build de eve — el mismo
 * problema que ya documenta `lib/crm/contacts.ts:289`.
 */
const PLACEHOLDER_PHONE_PREFIXES = ["+pending", "+google", "+signup"];

export const isRealPhoneE164 = (
  phoneE164: string | null | undefined
): boolean =>
  typeof phoneE164 === "string" &&
  phoneE164.startsWith("+") &&
  !PLACEHOLDER_PHONE_PREFIXES.some((prefix) => phoneE164.startsWith(prefix));

/**
 * Teléfono: solo dígitos, con código de país y SIN el `+`.
 * `Contact.phoneE164` ya viene como `+573105833188`, así que basta con
 * quitar todo lo que no sea dígito.
 */
export const hashPhone = (phoneE164: string | null | undefined): string | null => {
  if (!isRealPhoneE164(phoneE164)) return null;
  const digits = phoneE164!.replace(/\D/g, "");
  if (!digits) return null;
  return sha256(digits);
};

/** Nombres: recortados, en minúscula, sin espacios internos. */
export const hashName = (name: string | null | undefined): string | null => {
  const normalized = name?.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return null;
  return sha256(normalized);
};

/** País: ISO-3166-1 alpha-2 en minúscula. */
export const hashCountry = (iso: string | null | undefined): string | null => {
  const normalized = iso?.trim().toLowerCase();
  if (!normalized || normalized.length !== 2) return null;
  return sha256(normalized);
};
