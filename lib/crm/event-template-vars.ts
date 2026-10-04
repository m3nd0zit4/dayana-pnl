import { getSiteUrl } from "@/lib/site-url";
import { formatMoneyMinor } from "./money";
import { SCHEDULE_REFERENCE_TZ, scheduleTemplateLines, scheduleVars } from "./event-schedule";

/**
 * Las plantillas de eventos y talleres con el horario por país, y los valores
 * de sus variables. Puro: lo usan los recordatorios, la confirmación, los
 * mensajes listos (también en el navegador) y las pruebas.
 *
 * WhatsApp rechaza un valor con saltos de línea, tabuladores o más de 4
 * espacios seguidos (error 132018): todos los valores salen en una línea.
 */

/** Para quien se inscribió o pagó (UTILIDAD): sin palabras de venta ni corazones. */
export const EVENT_ACCESS_BODY = [
  "Hola {{nombre}}, te escribimos porque te inscribiste en {{evento}}.",
  "",
  "Fecha: {{fecha}}",
  "Enlace para ingresar: {{enlace}}",
  "",
  "Hora según tu país:",
  scheduleTemplateLines(),
  "",
  "Si ya no puedes asistir, responde este mensaje.",
].join("\n");

/** Invitación (MARKETING). En {{mensaje}} van las palabras de Dayana. */
export const EVENT_INVITATION_BODY = [
  "Hola {{nombre}}, {{mensaje}}",
  "",
  "✨ {{evento}}",
  "📅 {{fecha}}",
  "💰 {{precio}}",
  "",
  "Horarios por país:",
  scheduleTemplateLines(),
  "",
  "Inscríbete aquí: {{enlace}}",
  "Te bendigo 💛",
].join("\n");

export const MENSAJE_MAX = 300;

/** Un valor en una sola línea: sin saltos ni espacios de más. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** «Tu mensaje»: una línea, espacios colapsados, hasta 300 caracteres. */
export const sanitizeMensaje = (s: string | null | undefined): string =>
  oneLine(s ?? "").slice(0, MENSAJE_MAX).trim();

type FreeEventSource = {
  headline: string;
  slug?: string | null;
  startsAt: Date | null;
  startsAtHasTime: boolean;
  meetUrl?: string | null;
};

type WorkshopSource = {
  title: string;
  slug: string;
  startsAt: Date | null;
  startsAtHasTime?: boolean;
  meetingUrl?: string | null;
  /** Precio vigente en unidades menores (`EditionPrices`). */
  prices?: { cop: number | null; usd: number | null } | null;
};

/** «$ 150.000 COP · US$40»; sin precio, que lo mire en la página. */
export const workshopPriceLabel = (prices: WorkshopSource["prices"]): string => {
  const parts = [
    prices?.cop != null ? `$ ${formatMoneyMinor(prices.cop, "COP")} COP` : null,
    prices?.usd != null ? `US$${formatMoneyMinor(prices.usd, "USD").replace(/\.00$/, "")}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Mira el precio en la página de inscripción";
};

/** «domingo 4 de octubre», en Colombia. */
export const colombiaDate = (d: Date | null): string => {
  if (!d) return "por confirmar";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("es-CO", { timeZone: SCHEDULE_REFERENCE_TZ, weekday: "long", day: "numeric", month: "long" })
      .formatToParts(d)
      .map((part) => [part.type, part.value])
  );
  return `${p.weekday} ${p.day} de ${p.month}`;
};

/**
 * Las variables de `evento_acceso` / `evento_invitacion` (todas menos
 * `nombre`, que pone el envío): evento, fecha, enlace, precio, mensaje y una
 * hora por región. `enlace`: la reunión para inscritas (la página si aún no
 * hay), la página pública para invitaciones.
 */
export const eventTemplateVars = (
  source: FreeEventSource | WorkshopSource,
  opts: { for: "inscrita" | "invitacion"; mensaje?: string | null }
): Record<string, string> => {
  const site = getSiteUrl();
  const isEvent = "headline" in source;
  const name = oneLine(isEvent ? source.headline : source.title);
  const page = isEvent
    ? `${site}/eventos-gratuitos${source.slug ? `/${encodeURIComponent(source.slug)}` : ""}`
    : `${site}/taller-virtual/${encodeURIComponent(source.slug)}`;
  const meet = oneLine((isEvent ? source.meetUrl : source.meetingUrl) ?? "");
  const hasTime = Boolean(source.startsAt) && source.startsAtHasTime !== false;
  return {
    evento: `«${name}»`,
    fecha: colombiaDate(source.startsAt),
    enlace: opts.for === "inscrita" && meet ? meet : page,
    precio: isEvent ? "Gratis" : workshopPriceLabel(source.prices),
    ...(opts.mensaje !== undefined ? { mensaje: sanitizeMensaje(opts.mensaje) } : {}),
    ...scheduleVars(source.startsAt, { hasTime }),
  };
};

/**
 * Pone los valores que hay y deja intactas las demás variables (en el texto
 * libre del envío masivo, {{nombre}} y {{mensaje}} se llenan al enviar).
 */
export const fillKnownVars = (body: string, vars: Record<string, string>): string =>
  body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (all, key: string) => (Object.hasOwn(vars, key) ? vars[key] : all));

/** El texto libre (gratis, dentro de las 24 h): la plantilla ya llena. Sin nombre, «Hola,». */
export const renderEventTemplate = (body: string, vars: Record<string, string>, nombre?: string | null): string => {
  const name = nombre?.trim();
  const withName = name ? body : body.replace(/Hola \{\{nombre\}\},/, "Hola,");
  return fillKnownVars(withName, { ...vars, ...(name ? { nombre: name } : {}) });
};
