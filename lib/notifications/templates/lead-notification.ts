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
