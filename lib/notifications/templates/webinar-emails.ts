import { siteUrl } from "../config";
import {
  escapeHtml,
  varsToPlainParagraphs,
  wrapEmailHtml,
  type SummaryRow,
} from "./email-layout";

/**
 * Correos del embudo del webinar gratuito que NO son la confirmación de
 * registro (esa vive en `lead-notification.ts` porque comparte plantilla con
 * el aviso interno a Dayana).
 *
 * Todos salen por `dispatchAndRecord` sin `campaignId`: son 1:1, así que no
 * llevan cabecera `List-Unsubscribe` — ponerla los mandaría a Promociones.
 */

export type WebinarMailInput = {
  firstName: string;
  meetUrl?: string | null;
  /** Nombre del material adjunto, si la edicion tiene uno. */
  materialFileName?: string | null;
  /** «9 de agosto de 2026 · 19:00 (America/Bogota)» */
  scheduleLabel?: string | null;
  timezone?: string | null;
};

const FOOTNOTE =
  "Recibes este correo porque te registraste en dayanabeltran.com/webinar-gratuito.";

const scheduleRows = (i: WebinarMailInput): SummaryRow[] => {
  const rows: SummaryRow[] = [];
  if (i.scheduleLabel) {
    rows.push({ label: "Cuándo", value: i.scheduleLabel, highlight: true });
  }
  rows.push({ label: "Dónde", value: "Google Meet (en línea)" });
  return rows;
};

/**
 * Enlace al material. Apunta a la ruta del sitio, no al blob: el blob es
 * privado y la ruta es la que comprueba que el webinar sigue vivo.
 */
const materialHtml = (fileName: string): string =>
  `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#33302b;text-align:center;">Material de apoyo: <a href="${escapeHtml(`${siteUrl()}/api/webinar/material`)}" style="color:#c0654a;font-weight:600;">descargar ${escapeHtml(fileName)}</a></p>`;

const materialText = (fileName: string): string =>
  `Material de apoyo (${fileName}): ${siteUrl()}/api/webinar/material`;

/** El enlace también en texto: algunos clientes ocultan los botones. */
const linkFallbackHtml = (meetUrl: string): string =>
  `<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#6b6256;text-align:center;word-break:break-all;">Si el botón no funciona, copia este enlace:<br /><a href="${escapeHtml(meetUrl)}" style="color:#c0654a;">${escapeHtml(meetUrl)}</a></p>`;

// ── Enlace de la reunión ────────────────────────────────────────────────────

export const webinarMeetLinkSubject = (): string =>
  "Tu enlace de acceso al webinar gratuito · Dayana Beltrán";

export const webinarMeetLinkHtml = (i: WebinarMailInput): string => {
  const meetUrl = i.meetUrl ?? "";
  const body = varsToPlainParagraphs([
    `Hola <strong style="font-weight:700;">${escapeHtml(i.firstName)}</strong>,`,
    `Ya tienes el enlace para entrar al <strong style="font-weight:600;">webinar gratuito</strong>. Guárdalo: es el mismo con el que entrarás el día del encuentro.`,
    i.scheduleLabel
      ? `Nos vemos el <strong style="font-weight:600;">${escapeHtml(i.scheduleLabel)}</strong>.`
      : `Te confirmamos la fecha por este mismo correo.`,
    `Te recomiendo entrar unos minutos antes y, si puedes, desde un lugar tranquilo.`,
  ]);

  return wrapEmailHtml({
    preheader: "Este es tu enlace para entrar al webinar gratuito.",
    eyebrow: "Webinar gratuito",
    title: "Tu enlace de acceso",
    bodyHtml:
      body +
      (meetUrl ? linkFallbackHtml(meetUrl) : "") +
      (i.materialFileName ? materialHtml(i.materialFileName) : ""),
    summaryRows: scheduleRows(i),
    ctaPrimary: meetUrl
      ? { label: "Entrar al webinar", href: meetUrl }
      : { label: "Ver la página del webinar", href: `${siteUrl()}/webinar-gratuito` },
    footnote: FOOTNOTE,
  });
};

export const webinarMeetLinkText = (i: WebinarMailInput): string =>
  [
    `Hola ${i.firstName},`,
    ``,
    `Ya tienes el enlace para entrar al webinar gratuito. Guárdalo: es el mismo del día del encuentro.`,
    i.scheduleLabel ? `Cuándo: ${i.scheduleLabel}.` : "",
    i.meetUrl ? `Enlace: ${i.meetUrl}` : "",
    i.materialFileName ? materialText(i.materialFileName) : "",
    ``,
    `Te recomiendo entrar unos minutos antes.`,
    ``,
    `Dayana Beltrán PNL`,
    `${siteUrl()}/webinar-gratuito`,
  ]
    .filter(Boolean)
    .join("\n");

// ── Recordatorios ───────────────────────────────────────────────────────────

export type ReminderKind = "24h" | "1h";

export type WebinarReminderInput = WebinarMailInput & { kind: ReminderKind };

export const webinarReminderSubject = (i: WebinarReminderInput): string =>
  i.kind === "24h"
    ? "Mañana es el webinar gratuito · Dayana Beltrán"
    : "Empezamos en una hora · webinar gratuito";

export const webinarReminderHtml = (i: WebinarReminderInput): string => {
  const meetUrl = i.meetUrl ?? "";
  const is24h = i.kind === "24h";
  const body = varsToPlainParagraphs(
    is24h
      ? [
          `Hola <strong style="font-weight:700;">${escapeHtml(i.firstName)}</strong>,`,
          `Te escribo para recordarte que <strong style="font-weight:600;">mañana</strong> nos vemos en el webinar gratuito.`,
          i.scheduleLabel
            ? `Es el <strong style="font-weight:600;">${escapeHtml(i.scheduleLabel)}</strong>.`
            : "",
          meetUrl
            ? `Aquí abajo tienes el enlace de acceso — el mismo que ya te envié.`
            : `Te enviaré el enlace de acceso antes de empezar.`,
        ]
      : [
          `Hola <strong style="font-weight:700;">${escapeHtml(i.firstName)}</strong>,`,
          `Empezamos en <strong style="font-weight:600;">una hora</strong>. Este es el momento de buscar un lugar tranquilo y dejar el teléfono a un lado.`,
          meetUrl ? `Entra con el botón de aquí abajo.` : "",
        ]
  );

  return wrapEmailHtml({
    preheader: is24h
      ? "Mañana nos vemos en el webinar gratuito."
      : "El webinar gratuito empieza en una hora.",
    eyebrow: "Webinar gratuito",
    title: is24h ? "Mañana nos vemos" : "Empezamos en una hora",
    bodyHtml:
      body +
      (meetUrl ? linkFallbackHtml(meetUrl) : "") +
      (i.materialFileName ? materialHtml(i.materialFileName) : ""),
    summaryRows: scheduleRows(i),
    ctaPrimary: meetUrl
      ? { label: "Entrar al webinar", href: meetUrl }
      : { label: "Ver la página del webinar", href: `${siteUrl()}/webinar-gratuito` },
    footnote: FOOTNOTE,
  });
};

export const webinarReminderText = (i: WebinarReminderInput): string =>
  [
    `Hola ${i.firstName},`,
    ``,
    i.kind === "24h"
      ? `Mañana nos vemos en el webinar gratuito.`
      : `El webinar gratuito empieza en una hora.`,
    i.scheduleLabel ? `Cuándo: ${i.scheduleLabel}.` : "",
    i.meetUrl ? `Enlace: ${i.meetUrl}` : "",
    i.materialFileName ? materialText(i.materialFileName) : "",
    ``,
    `Dayana Beltrán PNL`,
    `${siteUrl()}/webinar-gratuito`,
  ]
    .filter(Boolean)
    .join("\n");
