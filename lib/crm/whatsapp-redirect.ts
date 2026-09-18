import crypto from "crypto";

/**
 * Enlaces de WhatsApp que pasan por el sitio antes de abrir wa.me, para saber
 * que alguien pulsó. Se usan donde el botón no vive en nuestra web —un correo—
 * y por tanto no hay JavaScript propio que avise del clic.
 *
 * El código lleva contacto, origen, tipo y destino, firmado con `AUTH_SECRET`:
 * sin firma cualquiera podría fabricar «esta persona fue a WhatsApp» para una
 * ficha ajena. El destino sólo puede ser WhatsApp, así que la ruta no sirve de
 * redirección abierta hacia otra web.
 */

export type WhatsAppRedirectKind = "lead" | "staff";

export type WhatsAppRedirectPayload = {
  contactId: string;
  source: string;
  kind: WhatsAppRedirectKind;
  /** URL de WhatsApp a la que se salta después de registrar el clic. */
  target: string;
};

const ALLOWED_TARGET = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//;

export const isAllowedWhatsAppTarget = (url: string): boolean =>
  ALLOWED_TARGET.test(url);

/** 22 caracteres de HMAC-SHA256 en base64url (132 bits). */
const SIGNATURE_LENGTH = 22;

const signingKey = (): string => {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    // Con clave vacía cualquier código falsificado pasaría la verificación.
    throw new Error("AUTH_SECRET es obligatorio para firmar enlaces de WhatsApp.");
  }
  return secret;
};

const sign = (data: string): string =>
  crypto
    .createHmac("sha256", signingKey())
    .update(`wa-redirect:${data}`)
    .digest("base64url")
    .slice(0, SIGNATURE_LENGTH);

type Wire = { c: string; s: string; k: "l" | "s"; t: string };

export const encodeWhatsAppRedirect = (payload: WhatsAppRedirectPayload): string => {
  if (!isAllowedWhatsAppTarget(payload.target)) {
    throw new Error("El destino de un enlace de WhatsApp tiene que ser wa.me.");
  }
  const wire: Wire = {
    c: payload.contactId,
    s: payload.source,
    k: payload.kind === "staff" ? "s" : "l",
    t: payload.target,
  };
  const data = Buffer.from(JSON.stringify(wire)).toString("base64url");
  return `${data}.${sign(data)}`;
};

/** `null` ante cualquier fallo: firma, forma o destino. */
export const decodeWhatsAppRedirect = (code: string): WhatsAppRedirectPayload | null => {
  const dot = code.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = code.slice(0, dot);
  const signature = code.slice(dot + 1);

  let expected: string;
  try {
    expected = sign(data);
  } catch {
    return null;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let wire: Partial<Wire>;
  try {
    wire = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof wire.c !== "string" ||
    !wire.c ||
    typeof wire.s !== "string" ||
    (wire.k !== "l" && wire.k !== "s") ||
    typeof wire.t !== "string" ||
    !isAllowedWhatsAppTarget(wire.t)
  ) {
    return null;
  }
  return {
    contactId: wire.c,
    source: wire.s,
    kind: wire.k === "s" ? "staff" : "lead",
    target: wire.t,
  };
};

const WHATSAPP_HREF = /href="(https:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^"]*)"/g;

/**
 * Reescribe los `href` de WhatsApp de un correo para que pasen por `/w/…`.
 *
 * Se hace por destinatario, justo antes de enviar: el HTML de una notificación
 * se construye una sola vez y se manda a varias personas, y cada una necesita
 * su propio código. Los `&amp;` del HTML se devuelven a `&` antes de firmar,
 * para que el destino sea la URL real y no su forma escapada.
 */
export const rewriteWhatsAppLinks = (
  html: string,
  input: { siteUrl: string; contactId: string; source: string; kind: WhatsAppRedirectKind },
): string => {
  const base = input.siteUrl.replace(/\/$/, "");
  return html.replace(WHATSAPP_HREF, (_match, url: string) => {
    const target = url.replace(/&amp;/g, "&");
    const code = encodeWhatsAppRedirect({
      contactId: input.contactId,
      source: input.source,
      kind: input.kind,
      target,
    });
    return `href="${base}/w/${code}"`;
  });
};
