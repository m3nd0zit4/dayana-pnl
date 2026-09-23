import { BRAND } from "@/lib/contact";
import { escapeHtml, wrapEmailHtml } from "./email-layout";

/**
 * Confirmación de una cita reservada en `/agenda`.
 *
 * Lleva el enlace de cancelar dentro a propósito: quien no puede venir y no
 * encuentra cómo avisar, simplemente no viene, y el hueco se pierde sin que
 * nadie se entere.
 */

export type AppointmentEmailInput = {
  firstName: string;
  title: string;
  startsAt: Date;
  /** Zona en la que se acordó la cita (IANA). */
  timezone: string;
  meetUrl: string | null;
  cancelUrl: string;
};

/** «jueves 25 de septiembre, 10:00 (Bogotá)» */
const whenLabel = (startsAt: Date, timezone: string): string => {
  const date = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(startsAt);
  const place = timezone.split("/").at(-1)?.replace(/_/g, " ") ?? timezone;
  return `${date}, ${time} (${place})`;
};

export const appointmentEmailSubject = (i: AppointmentEmailInput): string =>
  `Confirmada: ${i.title}`;

export const appointmentEmailHtml = (i: AppointmentEmailInput): string =>
  wrapEmailHtml({
    title: i.title,
    eyebrow: "Tu cita está confirmada",
    preheader: whenLabel(i.startsAt, i.timezone),
    bodyHtml: `<p style="margin:0 0 14px;">Hola ${escapeHtml(i.firstName)}, te espero el <strong>${escapeHtml(
      whenLabel(i.startsAt, i.timezone)
    )}</strong>.</p>${
      i.meetUrl
        ? `<p style="margin:0 0 14px;">Nos vemos por Google Meet; el enlace está aquí abajo y también en la invitación de tu calendario.</p>`
        : `<p style="margin:0 0 14px;">Te enviamos el enlace de la videollamada antes de la cita.</p>`
    }<p style="margin:0;">Si no puedes, avísame con el enlace del final para dejar el espacio libre a alguien más.</p>`,
    ...(i.meetUrl
      ? { ctaPrimary: { href: i.meetUrl, label: "Entrar a la videollamada" } }
      : {}),
    ctaSecondary: { href: i.cancelUrl, label: "Cancelar la cita" },
    footnote: `Si el botón no abre, copia este enlace para cancelar: ${i.cancelUrl}`,
  });

export const appointmentEmailText = (i: AppointmentEmailInput): string =>
  [
    `Hola ${i.firstName},`,
    ``,
    `Tu cita está confirmada: ${i.title}.`,
    `Cuándo: ${whenLabel(i.startsAt, i.timezone)}.`,
    i.meetUrl ? `Videollamada: ${i.meetUrl}` : `Te enviamos el enlace antes de la cita.`,
    ``,
    `¿No puedes? Cancela aquí y liberas el espacio: ${i.cancelUrl}`,
    ``,
    BRAND.name,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
