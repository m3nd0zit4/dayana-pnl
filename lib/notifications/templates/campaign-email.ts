import { renderQuickMessage } from "@/lib/crm/render-message";
import type { TemplateVars } from "../variables";
import { escapeHtml, varsToPlainParagraphs, wrapEmailHtml } from "./email-layout";

export const campaignEmailSubject = (
  templateTitle: string,
  vars: TemplateVars
): string => {
  const workshop = vars.workshop_title;
  if (workshop) return `${templateTitle} — ${workshop}`;
  return templateTitle || "Novedades — Dayana Beltrán PNL";
};

export const campaignEmailHtml = (
  templateTitle: string,
  body: string,
  vars: TemplateVars,
  unsubscribeUrl?: string
): string => {
  const plain = renderQuickMessage(body, vars);
  const paragraphs = plain
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => p.trim());

  const workshopRows =
    vars.workshop_title && vars.workshop_date
      ? [
          { label: "Taller", value: vars.workshop_title },
          { label: "Fecha", value: vars.workshop_date },
          ...(vars.workshop_schedule
            ? [{ label: "Horario", value: vars.workshop_schedule }]
            : []),
        ]
      : undefined;

  return wrapEmailHtml({
    preheader: plain.slice(0, 120),
    title: templateTitle,
    introHtml: `<p style="margin:0 0 16px;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#0a0a0a;text-align:center;">Hola <strong>${escapeHtml(vars.first_name)}</strong>,</p>`,
    bodyHtml: varsToPlainParagraphs(paragraphs),
    summaryRows: workshopRows,
    ctaPrimary: vars.workshop_url
      ? { label: "Ver talleres en la web", href: vars.workshop_url }
      : { label: "Visitar dayanabeltran.com", href: vars.site_url },
    unsubscribeUrl,
  });
};

export const campaignPlainText = (body: string, vars: TemplateVars): string =>
  renderQuickMessage(body, vars);
