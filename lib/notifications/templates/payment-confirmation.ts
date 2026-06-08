import type { TemplateVars } from "../variables";
import {
  escapeHtml,
  paymentWhatsAppHref,
  varsToPlainParagraphs,
  wrapEmailHtml,
} from "./email-layout";

export const paymentConfirmationSubject = (vars: TemplateVars): string =>
  `Tu pago está confirmado — ${vars.product_title ?? "Dayana Beltrán PNL"}`;

export const paymentConfirmationHtml = (vars: TemplateVars): string => {
  const firstName = escapeHtml(vars.first_name);
  const product = escapeHtml(vars.product_title);
  const amount = escapeHtml(vars.payment_amount);
  const date = escapeHtml(vars.payment_date);

  const bodyHtml = varsToPlainParagraphs([
    `Hola <strong style="font-weight:600;">${firstName}</strong>,`,
    `Gracias por confiar en este proceso. Tu pago quedó registrado correctamente.`,
    vars.sessions_total
      ? `Coordinaremos tus <strong style="font-weight:600;">${escapeHtml(vars.sessions_total)}</strong> sesiones contigo por WhatsApp en el horario que mejor te funcione.`
      : `En breve te acompañamos con los siguientes pasos.`,
  ]);

  const summaryRows = [
    { label: "Servicio", value: vars.product_title },
    { label: "Monto pagado", value: vars.payment_amount, highlight: true },
    { label: "Fecha", value: vars.payment_date },
  ];

  if (vars.sessions_total) {
    summaryRows.push({
      label: "Sesiones",
      value: `${vars.sessions_total} incluidas en tu paquete`,
    });
  }

  const hasTherapySessions = Boolean(vars.sessions_total);

  return wrapEmailHtml({
    preheader: `Pago confirmado · ${vars.payment_amount} · ${vars.product_title}`,
    title: "Pago confirmado",
    bodyHtml,
    summaryRows,
    ctaPrimary: hasTherapySessions
      ? {
          label: "Coordinar por WhatsApp",
          href: paymentWhatsAppHref(vars.first_name, vars.product_title),
        }
      : {
          label: "Visitar el sitio",
          href: vars.site_url,
        },
    ctaSecondary: hasTherapySessions
      ? { label: "Ver dayanabeltran.com", href: vars.site_url }
      : undefined,
  });
};

const hasTherapySessions = (vars: TemplateVars) => Boolean(vars.sessions_total);

export const paymentConfirmationText = (vars: TemplateVars): string =>
  [
    `Hola ${vars.first_name},`,
    "",
    "Tu pago quedó confirmado.",
    "",
    `Servicio: ${vars.product_title}`,
    `Monto: ${vars.payment_amount}`,
    `Fecha: ${vars.payment_date}`,
    vars.sessions_total ? `Sesiones: ${vars.sessions_total}` : "",
    "",
    hasTherapySessions(vars)
      ? `Coordinar por WhatsApp: ${paymentWhatsAppHref(vars.first_name, vars.product_title)}`
      : vars.site_url,
    "",
    "Dayana Beltrán PNL",
    "contacto@dayanabeltran.com",
  ]
    .filter(Boolean)
    .join("\n");
