import crypto from "crypto";

const PREFIX = "chk:";

/**
 * PayPal custom_id / MP external_reference for unpaid checkout (contact +
 * plan, no enrollment yet). When a promo code was applied, the code and the
 * discount actually baked into the charged amount travel along too — the
 * capture/webhook step reads them back to compute the SAME expected amount
 * used at creation, rather than re-validating the code (which could have
 * expired or hit its redemption cap in the few minutes between creating the
 * order and the customer completing payment, wrongly rejecting or
 * mis-crediting a payment that was already correctly charged).
 *
 * ## Por qué va firmada
 *
 * Este es nuestro equivalente de la opción "pagos en sitio web cifrados" de
 * PayPal, que protegía los datos del botón de que un tercero los manipulara.
 * Aquí el dato sensible es `discountMinor`: viaja dentro de la referencia y
 * después se usa para calcular el importe esperado, así que una referencia
 * fabricada podría reclamar un descuento que nunca se validó.
 *
 * Hoy la referencia la construye el servidor y sólo vuelve dentro de un webhook
 * con firma verificada, así que no es un agujero explotable — la firma es
 * defensa en profundidad, y barata.
 */
const signingKey = (): string => {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    // Igual que en `lib/social/oauth-state.ts`: con clave vacía la firma y la
    // verificación coinciden siempre y CUALQUIER referencia falsificada pasa,
    // en silencio y sólo en el despliegue mal configurado.
    throw new Error(
      "AUTH_SECRET es obligatorio para firmar la referencia de checkout."
    );
  }
  return secret;
};

/**
 * 16 caracteres de HMAC-SHA256 en base64url.
 *
 * Recortada a propósito: `custom_id` de PayPal admite 127 caracteres y ahí
 * dentro ya viajan un cuid de contacto, el id de plan y, si hay promo, el
 * código y el descuento. 96 bits siguen siendo inviables de adivinar para un
 * atacante que además no obtiene nada por acertar salvo reusar un descuento.
 */
const SIGNATURE_LENGTH = 16;

const sign = (payload: string): string =>
  crypto
    .createHmac("sha256", signingKey())
    .update(payload)
    .digest("base64url")
    .slice(0, SIGNATURE_LENGTH);

const timingSafeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const encodePayload = (
  contactId: string,
  planId: string,
  promo?: { code: string; discountMinor: number }
): string =>
  promo
    ? `${contactId}:${planId}:${promo.code}:${promo.discountMinor}`
    : `${contactId}:${planId}`;

export const encodeCheckoutReference = (
  contactId: string,
  planId: string,
  promo?: { code: string; discountMinor: number }
): string => {
  const payload = encodePayload(contactId, planId, promo);
  return `${PREFIX}${payload}:${sign(payload)}`;
};

export const parseCheckoutReference = (
  value: string
): {
  contactId: string;
  planId: string;
  promoCode?: string;
  discountMinor?: number;
  /** `false` para las referencias del formato antiguo, sin firma. */
  signed: boolean;
} | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const rest = trimmed.slice(PREFIX.length);
  const parts = rest.split(":");

  /**
   * Se aceptan cuatro formas: con firma (3 o 5 partes) y sin ella (2 o 4).
   *
   * Las viejas SIGUEN valiendo a propósito. Al desplegar habrá órdenes en
   * vuelo creadas minutos antes con el formato anterior, y rechazarlas
   * significaría cobrar el dinero y no registrar la compra. La firma es
   * defensa en profundidad, no la única barrera: el webhook ya viene
   * autenticado por el proveedor.
   */
  const signed = parts.length === 3 || parts.length === 5;
  if (!signed && parts.length !== 2 && parts.length !== 4) return null;

  const signature = signed ? parts[parts.length - 1] : null;
  const body = signed ? parts.slice(0, -1) : parts;

  const contactId = body[0]?.trim();
  const planId = body[1]?.trim();
  if (!contactId || !planId) return null;

  if (signed) {
    const payload = body.join(":");
    if (!signature || !timingSafeEqual(signature, sign(payload))) return null;
  }

  if (body.length === 2) return { contactId, planId, signed };

  const promoCode = body[2]?.trim();
  const discountMinor = Number(body[3]);
  if (!promoCode || !Number.isFinite(discountMinor)) return null;
  return { contactId, planId, promoCode, discountMinor, signed };
};

export const isCheckoutReference = (value: string): boolean =>
  parseCheckoutReference(value) !== null;
