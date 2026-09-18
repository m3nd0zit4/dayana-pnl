import { WHATSAPP_NUMBER, buildWhatsAppUrl } from "@/lib/contact";
import { getDateKeyInTz, getTimeHmInTz } from "@/lib/datetime/zoned-time";
import { siteUrl } from "../config";
import { escapeHtml, varsToPlainParagraphs, wrapEmailHtml } from "./email-layout";

/**
 * Recordatorios de taller PAGADO (24 h y 1 h antes de que arranque la
 * edición). Mismo tono y estructura visual que los del webinar gratuito
 * (`webinar-emails.ts`), pero:
 *
 * - el CTA lleva a `/taller-virtual/<slug>` — la página que muestra el
 *   contenido a quien ya pagó — y no a un enlace de reunión;
 * - la fecha/hora se calcula aquí mismo a partir de `startsAt` + `timezone`
 *   de la edición (no hay un `dateLabel`/`scheduleLabel` de staff que
 *   garantice llevar la hora real), con la misma técnica de anclar al
 *   mediodía UTC que usa `formatWebinarScheduleLabel` para no arrastrar
 *   saltos de día por DST;
 * - añade una línea de WhatsApp para cuando algo falla el día del taller,
 *   que el webinar no necesita porque su footer ya apunta al enlace de la
 *   reunión.
 */

export type WorkshopReminderPass = "24h" | "1h";

export type WorkshopReminderInput = {
  firstName: string;
  title: string;
  slug: string;
  startsAt: Date;
  /** IANA, p. ej. "America/Bogota". */
  timezone: string;
  pass: WorkshopReminderPass;
};

const workshopUrl = (slug: string): string =>
  `${siteUrl()}/taller-virtual/${slug}`;

/** «9 de agosto de 2026 · 19:00 (America/Bogota)», calculada en vivo. */
export const workshopReminderScheduleLabel = (
  i: Pick<WorkshopReminderInput, "startsAt" | "timezone">
): string => {
  const dateKey = getDateKeyInTz(i.startsAt, i.timezone);
  const [y, m, d] = dateKey.split("-").map(Number);
  // Ancla a mediodía UTC del día calendario en la zona: evita que formatear
  // la fecha con Intl vuelva a desplazar el día por el huso horario local
  // de quien ejecuta el proceso.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  const datePart = anchor.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const timePart = getTimeHmInTz(i.startsAt, i.timezone);
  return `${datePart} · ${timePart} (${i.timezone})`;
};

const whatsAppFailHref = (title: string): string =>
  buildWhatsAppUrl(
    `Hola Dayana, tengo un problema para entrar al taller "${title}".`
  );

const whatsAppFailHtml = (title: string): string =>
  `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b6256;text-align:center;">¿Algo falla el día del taller? Escríbele a Dayana por <a href="${escapeHtml(whatsAppFailHref(title))}" style="color:#c0654a;font-weight:600;">WhatsApp</a>.</p>`;

const FOOTNOTE =
  "Recibes este correo porque te inscribiste y pagaste este taller en dayanabeltran.com.";


/**
 * «hoy» o «mañana» segun la fecha local de la edicion. La ventana de 24 h
 * tambien atrapa a quien compra la mañana de un taller nocturno, y a esa
 * persona no se le puede decir «mañana».
 */
const dayWord = (i: WorkshopReminderInput): "hoy" | "mañana" =>
  getDateKeyInTz(i.startsAt, i.timezone) === getDateKeyInTz(new Date(), i.timezone)
    ? "hoy"
    : "mañana";

export const workshopReminderSubject = (i: WorkshopReminderInput): string =>
  i.pass === "24h"
    ? `Tu taller es ${dayWord(i)}: ${i.title}`
    : `Tu taller empieza en 1 hora: ${i.title}`;

export const workshopReminderHtml = (i: WorkshopReminderInput): string => {
  const is24h = i.pass === "24h";
  const label = workshopReminderScheduleLabel(i);
  const url = workshopUrl(i.slug);

  const body = varsToPlainParagraphs(
    is24h
      ? [
          `Hola <strong style="font-weight:700;">${escapeHtml(i.firstName)}</strong>,`,
          `Te escribo para recordarte que <strong style="font-weight:600;">${dayWord(i)}</strong> es tu taller: <strong style="font-weight:600;">${escapeHtml(i.title)}</strong>.`,
          `Es el <strong style="font-weight:600;">${escapeHtml(label)}</strong>.`,
          `Entra con el botón de aquí abajo el día del taller — el mismo enlace te lleva directo al contenido.`,
        ]
      : [
          `Hola <strong style="font-weight:700;">${escapeHtml(i.firstName)}</strong>,`,
          `Empezamos en <strong style="font-weight:600;">una hora</strong>: <strong style="font-weight:600;">${escapeHtml(i.title)}</strong>.`,
          `Este es el momento de buscar un lugar tranquilo y dejar el teléfono a un lado.`,
          `Entra con el botón de aquí abajo.`,
        ]
  );

  return wrapEmailHtml({
    preheader: is24h
      ? `${dayWord(i) === "hoy" ? "Hoy" : "Mañana"} es tu taller: ${i.title}.`
      : `Tu taller empieza en 1 hora: ${i.title}.`,
    eyebrow: "Taller",
    title: is24h ? `Tu taller es ${dayWord(i)}` : "Empezamos en 1 hora",
    bodyHtml: body + whatsAppFailHtml(i.title),
    summaryRows: [
      { label: "Taller", value: i.title },
      { label: "Cuándo", value: label, highlight: true },
    ],
    ctaPrimary: { label: "Entrar al taller", href: url },
    footnote: FOOTNOTE,
  });
};

export const workshopReminderText = (i: WorkshopReminderInput): string => {
  const is24h = i.pass === "24h";
  const label = workshopReminderScheduleLabel(i);
  const url = workshopUrl(i.slug);

  return [
    `Hola ${i.firstName},`,
    ``,
    is24h
      ? `${dayWord(i) === "hoy" ? "Hoy" : "Mañana"} es tu taller: ${i.title}.`
      : `Tu taller empieza en 1 hora: ${i.title}.`,
    `Cuándo: ${label}.`,
    `Entra aquí: ${url}`,
    ``,
    `¿Algo falla? Escríbele a Dayana por WhatsApp: ${WHATSAPP_NUMBER}`,
    ``,
    `Dayana Beltrán PNL`,
  ]
    .filter(Boolean)
    .join("\n");
};
