/**
 * Las reglas de un envío de WhatsApp desde el CRM, sin base de datos ni red
 * (para probarlas).
 *
 * WhatsApp solo deja escribir texto libre dentro de las 24 h desde el último
 * mensaje de la persona. Fuera de eso hace falta una plantilla aprobada por
 * Meta, que se cobra por mensaje.
 */

export type SendPlan =
  | { action: "text" }
  | { action: "template" }
  | { action: "skip"; reason: "no_phone" | "opted_out" | "needs_template" };

export const planSend = (input: {
  hasPhone: boolean;
  optedOut: boolean;
  windowOpen: boolean;
  hasApprovedTemplate: boolean;
}): SendPlan => {
  if (!input.hasPhone) return { action: "skip", reason: "no_phone" };
  if (input.optedOut) return { action: "skip", reason: "opted_out" };
  if (input.windowOpen) return { action: "text" };
  if (input.hasApprovedTemplate) return { action: "template" };
  return { action: "skip", reason: "needs_template" };
};

/**
 * Clave de `whatsapp_sends.vars` con el id del medio de la imagen del envío
 * (subida una vez a WhatsApp, la reutilizan todas). Empieza por `__` para no
 * chocar con una variable de plantilla.
 */
export const HEADER_IMAGE_VAR = "__headerImageId";
/**
 * La copia de esa imagen en Blob (URL y tipo), solo para que el chat del CRM
 * la muestre: a WhatsApp se le manda el id de arriba.
 */
export const HEADER_IMAGE_URL_VAR = "__headerImageUrl";
export const HEADER_IMAGE_MIME_VAR = "__headerImageMime";
/**
 * A quién le llega la imagen (`HeaderImageScope`). Sin la clave, `all`: los
 * envíos de antes solo podían llevar imagen con plantilla con imagen arriba.
 */
export const HEADER_IMAGE_SCOPE_VAR = "__headerImageScope";

export type HeaderImageCopy = { url: string; mimeType: string };

/**
 * A quién le llega la imagen de un envío:
 * - `all`: la plantilla aprobada lleva imagen arriba; les llega a todas
 *   (cabecera de la plantilla fuera de las 24 h, imagen con pie dentro).
 * - `window`: plantilla solo de texto (o sin plantilla). La imagen les llega
 *   solo a quienes escribieron en las últimas 24 h; las demás reciben la
 *   plantilla sin imagen, porque Meta rechaza una cabecera que la plantilla
 *   aprobada no tiene.
 */
export type HeaderImageScope = "all" | "window";

/** El alcance de la imagen según la cabecera de la plantilla aprobada. */
export const headerImageScope = (headerFormat: string | null | undefined): HeaderImageScope =>
  headerFormat === "IMAGE" ? "all" : "window";

/** Si la imagen del envío va en el mensaje de esta persona (texto libre o plantilla). */
export const sendsHeaderImage = (action: "text" | "template", scope: HeaderImageScope): boolean =>
  action === "text" || scope === "all";

export type SendHeaderImage = { id: string; copy: HeaderImageCopy | null; scope: HeaderImageScope };

/**
 * Separa la imagen del envío (las claves `__…`) de las variables del mensaje:
 * esas no son de la plantilla y no pueden acabar en el texto.
 */
export const splitSendVars = (
  raw: Record<string, string> | null | undefined
): { vars: Record<string, string>; headerImage: SendHeaderImage | null } => {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) if (!key.startsWith("__")) vars[key] = value;
  const id = raw?.[HEADER_IMAGE_VAR];
  const url = raw?.[HEADER_IMAGE_URL_VAR];
  return {
    vars,
    headerImage: id
      ? {
          id,
          copy: url ? { url, mimeType: raw?.[HEADER_IMAGE_MIME_VAR] || "image/jpeg" } : null,
          scope: raw?.[HEADER_IMAGE_SCOPE_VAR] === "window" ? "window" : "all",
        }
      : null,
  };
};

/** WhatsApp no acepta el pie de una imagen de más de 1024 caracteres. */
export const IMAGE_CAPTION_MAX = 1024;

/**
 * Imagen con el texto de pie (dentro de las 24 h). Si el texto, ya con
 * {{nombre}} puesto, no cabe en el pie, WhatsApp rechazaría el mensaje
 * entero: la imagen va sin pie y el texto en un mensaje aparte, justo después.
 */
export const splitImageCaption = (body: string): { caption: string; separateText: string | null } =>
  body.length > IMAGE_CAPTION_MAX ? { caption: "", separateText: body } : { caption: body, separateText: null };

/**
 * Imagen y plantilla: una plantilla con cabecera IMAGE sin imagen la rechaza
 * Meta. Con una plantilla solo de texto (o sin plantilla) la imagen sí se
 * puede: les llega solo a quienes escribieron en las últimas 24 h
 * (`headerImageScope`). `headerFormat`: el de la plantilla aprobada en
 * 360dialog (`null` sin cabecera, `undefined` si no se pudo comprobar).
 * Devuelve el motivo para mostrárselo a quien envía, o `null` si se puede.
 */
export const headerImageProblem = (input: {
  hasImage: boolean;
  /** Título de la plantilla aprobada que se usaría, o `null` si no hay. */
  templateTitle: string | null;
  headerFormat: string | null | undefined;
}): string | null => {
  const { hasImage, templateTitle, headerFormat } = input;
  if (!hasImage) {
    return templateTitle && headerFormat === "IMAGE"
      ? `La plantilla «${templateTitle}» lleva una imagen arriba: adjunta la imagen para poder enviarla.`
      : null;
  }
  // Sin saber si la plantilla lleva imagen no se sabe a quién mandársela:
  // con imagen arriba, sin ella Meta la rechaza; sin imagen arriba, con ella.
  if (templateTitle && headerFormat === undefined) {
    return `No pude comprobar en 360dialog si la plantilla «${templateTitle}» lleva imagen. Inténtalo de nuevo en un momento o envía sin imagen.`;
  }
  return null;
};

/** Reemplaza {{nombre}}, {{evento}}… Lo que no tiene valor se quita. */
export const fillVars = (text: string, vars: Record<string, string | null | undefined>): string =>
  text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, key: string) => vars[key]?.toString().trim() ?? "");

/** Los valores de {{1}}, {{2}}… de una plantilla, en el orden que tiene aprobado. */
export const templateParams = (
  varNames: string[],
  vars: Record<string, string | null | undefined>
): string[] =>
  // WhatsApp rechaza un parámetro vacío: se pone un guion.
  varNames.map((name) => vars[name]?.toString().trim() || "-");

/** Primer nombre, para saludar sin sonar a formulario. */
export const firstName = (full: string | null | undefined): string =>
  (full ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * Palabras con las que alguien pide que no le escriban más. Se miran solo en
 * mensajes cortos: «no más» en medio de una historia larga no es una baja.
 */
export const isOptOutMessage = (body: string | null | undefined): boolean => {
  const text = (body ?? "").trim().toLowerCase();
  if (!text || text.length > 60) return false;
  return /^(stop|baja|cancelar suscripci[oó]n|no m[aá]s mensajes|no me escrib(as|an)( m[aá]s)?|no quiero (recibir )?m[aá]s mensajes|no m[aá]s)[.!¡ ]*$/i.test(
    text
  );
};

export type SendSummary = {
  total: number;
  text: number;
  template: number;
  skipped: { no_phone: number; opted_out: number; needs_template: number };
  estimatedCost: number;
};

/** Cuántos van gratis, cuántos por plantilla (y cuánto costaría), cuántos no. */
export const summarizePlans = (plans: SendPlan[], pricePerTemplate: number): SendSummary => {
  const summary: SendSummary = {
    total: plans.length,
    text: 0,
    template: 0,
    skipped: { no_phone: 0, opted_out: 0, needs_template: 0 },
    estimatedCost: 0,
  };
  for (const p of plans) {
    if (p.action === "text") summary.text++;
    else if (p.action === "template") summary.template++;
    else summary.skipped[p.reason]++;
  }
  // Precio plano; `previewSend` lo cambia por la suma de las tarifas por país.
  summary.estimatedCost = Math.round(summary.template * pricePerTemplate * 10000) / 10000;
  return summary;
};

/**
 * Cómo sale un mensaje aprobado por Dayana:
 * - `text`: escribió hace menos de 24 h, va tal cual y gratis.
 * - `template`: fuera de las 24 h, con la plantilla aprobada (se cobra).
 * - `phone`: fuera de las 24 h y sin plantilla aprobada. El CRM no puede
 *   enviarlo; se abre el WhatsApp de Dayana con el mensaje escrito (gratis).
 */
export type ApprovalDelivery = "text" | "template" | "phone";

export const approvalDelivery = (input: {
  windowOpen: boolean;
  hasApprovedTemplate: boolean;
}): ApprovalDelivery => (input.windowOpen ? "text" : input.hasApprovedTemplate ? "template" : "phone");

/** `never`: la persona nunca ha escrito (le escribimos nosotros primero). */
export type WindowState = "open" | "closed" | "never";

export const windowStateOf = (lastInboundAt: Date | null, now = Date.now()): WindowState =>
  !lastInboundAt ? "never" : now - lastInboundAt.getTime() < 24 * 3600_000 ? "open" : "closed";

/** El aviso encima de la caja de escribir, según la ventana. */
export const windowNotice = (state: WindowState): string | null =>
  state === "open"
    ? null
    : state === "never"
      ? "Esta persona todavía no te ha escrito: WhatsApp solo deja escribirle primero con una plantilla aprobada por Meta (WhatsApp → Plantillas)."
      : "Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja escribirle con una plantilla aprobada por Meta (WhatsApp → Plantillas).";
