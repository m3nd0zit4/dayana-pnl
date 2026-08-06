import { buildWhatsAppUrl } from "@/lib/contact";
import { siteUrl } from "../config";
import {
  escapeHtml,
  varsToPlainParagraphs,
  wrapEmailHtml,
  type SummaryRow,
} from "./email-layout";

export type LeadEmailInput = {
  firstName: string;
  lastName?: string | null;
  phoneE164: string;
  phoneCountry?: string | null;
  email?: string | null;
  interest?: string | null;
  message?: string | null;
  source?: string | null;
  createdAt?: Date;
};

const fullName = (i: LeadEmailInput) =>
  [i.firstName, i.lastName].filter(Boolean).join(" ").trim() || i.firstName;

const fmtDate = (d?: Date) =>
  (d ?? new Date()).toLocaleString("es-CO", {
    dateStyle: "long",
    timeStyle: "short",
  });

// ── Internal: notify Dayana that a new contact came in ──────────────────────
export const leadNotificationSubject = (i: LeadEmailInput): string =>
  `Nuevo contacto · ${fullName(i)}`;

export const leadNotificationHtml = (i: LeadEmailInput): string => {
  const rows: SummaryRow[] = [
    { label: "Nombre", value: fullName(i), highlight: true },
    { label: "WhatsApp / teléfono", value: i.phoneE164 },
  ];
  if (i.email) rows.push({ label: "Correo", value: i.email });
  if (i.phoneCountry) rows.push({ label: "País", value: i.phoneCountry });
  if (i.interest) rows.push({ label: "Interés", value: i.interest });
  rows.push({ label: "Origen", value: i.source || "web" });
  rows.push({ label: "Fecha", value: fmtDate(i.createdAt) });

  const body = varsToPlainParagraphs([
    `<strong style="font-weight:700;">${escapeHtml(fullName(i))}</strong> acaba de dejar sus datos desde el sitio.`,
    i.message
      ? `Su mensaje: <em style="color:#5c554b;">“${escapeHtml(i.message)}”</em>`
      : `No dejó un mensaje adicional.`,
  ]);

  const waDigits = i.phoneE164.replace(/[^0-9]/g, "");

  return wrapEmailHtml({
    preheader: `Nuevo contacto: ${fullName(i)} · ${i.phoneE164}`,
    eyebrow: "Nuevo lead",
    title: "Tienes un nuevo contacto",
    bodyHtml: body,
    summaryRows: rows,
    ctaPrimary: {
      label: "Escribir por WhatsApp",
      href: buildWhatsAppUrl(
        `Hola ${i.firstName}, soy Dayana. Recibí tu mensaje desde la web 💛`
      ).replace(/wa\.me\/\d+/, `wa.me/${waDigits}`),
    },
    ctaSecondary: { label: "Ver el sitio", href: siteUrl() },
  });
};

export const leadNotificationText = (i: LeadEmailInput): string =>
  [
    `Nuevo contacto desde la web`,
    ``,
    `Nombre: ${fullName(i)}`,
    `WhatsApp: ${i.phoneE164}`,
    i.email ? `Correo: ${i.email}` : "",
    i.phoneCountry ? `País: ${i.phoneCountry}` : "",
    i.interest ? `Interés: ${i.interest}` : "",
    `Origen: ${i.source || "web"}`,
    `Fecha: ${fmtDate(i.createdAt)}`,
    i.message ? `\nMensaje: ${i.message}` : "",
  ]
    .filter(Boolean)
    .join("\n");

// ── Confirmation back to the person who wrote in ────────────────────────────
export const leadConfirmationSubject = (): string =>
  `Recibí tu mensaje — Dayana Beltrán`;

export const leadConfirmationHtml = (i: LeadEmailInput): string => {
  const body = varsToPlainParagraphs([
    `Hola <strong style="font-weight:700;">${escapeHtml(i.firstName)}</strong>,`,
    `Gracias por escribirme. Tu mensaje llegó bien y lo leo personalmente — te contacto muy pronto para que demos el primer paso, sin prisa.`,
    i.interest
      ? `Anoté que te interesa: <strong style="font-weight:600;">${escapeHtml(i.interest)}</strong>.`
      : `Mientras tanto, puedes conocer más sobre el proceso en el sitio.`,
  ]);

  return wrapEmailHtml({
    preheader: "Recibí tu mensaje — te contacto muy pronto.",
    eyebrow: "Gracias por escribir",
    title: "Tu mensaje está en camino a mí",
    bodyHtml: body,
    ctaPrimary: { label: "Conocer el proceso", href: siteUrl() },
    footnote:
      "Recibes este correo porque dejaste tus datos en dayanabeltran.com. Si no fuiste tú, ignóralo.",
  });
};

export const leadConfirmationText = (i: LeadEmailInput): string =>
  [
    `Hola ${i.firstName},`,
    ``,
    `Gracias por escribirme. Tu mensaje llegó bien y lo leo personalmente — te contacto muy pronto.`,
    i.interest ? `Anoté que te interesa: ${i.interest}.` : "",
    ``,
    `Dayana Beltrán PNL`,
    siteUrl(),
  ]
    .filter(Boolean)
    .join("\n");

// ── Webinar gratuito confirmation ───────────────────────────────────────────
export type WebinarLeadEmailInput = LeadEmailInput & {
  alreadyRegistered?: boolean;
  /** Human-readable schedule tip, e.g. "15 de agosto · 19:00 (hora Colombia)". */
  scheduleLabel?: string | null;
};

export const webinarConfirmationSubject = (
  i: WebinarLeadEmailInput
): string =>
  i.alreadyRegistered
    ? `Ya estabas registrada — webinar gratuito · Dayana Beltrán`
    : `Tu lugar está reservado — webinar gratuito · Dayana Beltrán`;

export const webinarConfirmationHtml = (i: WebinarLeadEmailInput): string => {
  const body = varsToPlainParagraphs(
    i.alreadyRegistered
      ? [
          `Hola <strong style="font-weight:700;">${escapeHtml(i.firstName)}</strong>,`,
          `Ya tenías tu lugar en el <strong style="font-weight:600;">webinar gratuito</strong>. No hace falta registrarte otra vez — tu inscripción sigue activa.`,
          i.scheduleLabel
            ? `Fecha prevista: <strong style="font-weight:600;">${escapeHtml(i.scheduleLabel)}</strong>.`
            : `Cuando confirmemos o actualicemos la fecha y el enlace, te escribimos al mismo correo.`,
        ]
      : [
          `Hola <strong style="font-weight:700;">${escapeHtml(i.firstName)}</strong>,`,
          `¡Listo! Tu lugar en el <strong style="font-weight:600;">webinar gratuito</strong> quedó reservado.`,
          i.scheduleLabel
            ? `Fecha prevista: <strong style="font-weight:600;">${escapeHtml(i.scheduleLabel)}</strong>.`
            : `Te enviaremos por este correo (y WhatsApp si hace falta) la fecha confirmada y el enlace de acceso.`,
          `Si no fuiste tú quien se registró, puedes ignorar este mensaje.`,
        ]
  );

  return wrapEmailHtml({
    preheader: i.alreadyRegistered
      ? "Ya estabas registrada en el webinar gratuito."
      : "Tu lugar en el webinar gratuito está reservado.",
    eyebrow: "Webinar gratuito",
    title: i.alreadyRegistered
      ? "Ya estabas registrada"
      : "Registro confirmado",
    bodyHtml: body,
    ctaPrimary: {
      label: "Ver la página del webinar",
      href: `${siteUrl()}/webinar-gratuito`,
    },
    footnote:
      "Recibes este correo porque te registraste en dayanabeltran.com/webinar-gratuito.",
  });
};

export const webinarConfirmationText = (i: WebinarLeadEmailInput): string =>
  [
    `Hola ${i.firstName},`,
    ``,
    i.alreadyRegistered
      ? `Ya tenías tu lugar en el webinar gratuito. Tu inscripción sigue activa.`
      : `¡Listo! Tu lugar en el webinar gratuito quedó reservado.`,
    i.scheduleLabel ? `Fecha prevista: ${i.scheduleLabel}.` : "",
    i.alreadyRegistered
      ? `Cuando actualicemos la fecha o el enlace, te escribimos al mismo correo.`
      : `Te enviaremos la fecha confirmada y el enlace de acceso.`,
    ``,
    `Dayana Beltrán PNL`,
    `${siteUrl()}/webinar-gratuito`,
  ]
    .filter(Boolean)
    .join("\n");
