import { BRAND, WHATSAPP_NUMBER, buildWhatsAppUrl } from "@/lib/contact";
import { siteUrl } from "../config";

export const BRAND_EMAIL = {
  ink: "#0a0a0a",
  paper: "#ffffff",
  linen: "#ece3d4",
  blush: "#edc3b1",
  sand: "#d4b896",
  terracotta: "#c0654a",
  muted: "#6b6256",
  line: "#e7ddcf",
  linenDark: "#e0d6c8",
} as const;

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export type SummaryRow = {
  label: string;
  value: string;
  highlight?: boolean;
};

export type EmailLayoutOptions = {
  preheader?: string;
  /** Small terracotta label above the title. */
  eyebrow?: string;
  title: string;
  introHtml?: string;
  bodyHtml: string;
  summaryRows?: SummaryRow[];
  ctaPrimary?: { label: string; href: string };
  ctaSecondary?: { label: string; href: string };
  /** Muted fine-print under the content (e.g. legal note). */
  footnote?: string;
};

// The site is a geometric-sans brand (Space Grotesk). Email clients can't load
// it reliably, so we mirror the look with a clean system-sans stack.
const fontSans =
  "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', Roboto, sans-serif";

export const emailButton = (
  href: string,
  label: string,
  variant: "primary" | "secondary" = "primary"
): string => {
  const c = BRAND_EMAIL;
  const isPrimary = variant === "primary";
  const bg = isPrimary ? c.terracotta : c.paper;
  const color = isPrimary ? c.paper : c.ink;
  const border = isPrimary ? c.terracotta : c.line;
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${bg};color:${color};text-decoration:none;padding:14px 30px;border-radius:999px;font-family:${fontSans};font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;border:1px solid ${border};margin:6px 6px;">${escapeHtml(label)}</a>`;
};

export const summaryCardHtml = (rows: SummaryRow[]): string => {
  const c = BRAND_EMAIL;
  const items = rows
    .map((row, i) => {
      const last = i === rows.length - 1;
      const border = last ? "none" : `1px solid ${c.line}`;
      const valueStyle = row.highlight
        ? `font-size:18px;font-weight:700;color:${c.ink};`
        : `font-size:15px;font-weight:500;color:${c.ink};`;
      return `<tr>
        <td style="padding:13px 0;border-bottom:${border};font-family:${fontSans};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${c.muted};width:40%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:13px 0;border-bottom:${border};${valueStyle}font-family:${fontSans};vertical-align:top;text-align:right;">${escapeHtml(row.value)}</td>
      </tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0 8px;background:${c.linen};border-radius:16px;">
    <tr><td style="padding:8px 22px;">${items}</td></tr>
  </table>`;
};

export const wrapEmailHtml = (opts: EmailLayoutOptions): string => {
  const c = BRAND_EMAIL;
  const preheader = escapeHtml(opts.preheader ?? opts.title);
  const summary = opts.summaryRows?.length
    ? summaryCardHtml(opts.summaryRows)
    : "";
  const intro = opts.introHtml ?? "";
  const eyebrow = opts.eyebrow
    ? `<p style="margin:0 0 10px;font-family:${fontSans};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:${c.terracotta};text-align:center;">${escapeHtml(opts.eyebrow)}</p>`
    : "";
  const footnote = opts.footnote
    ? `<p style="margin:18px 0 0;font-family:${fontSans};font-size:11px;line-height:1.6;color:${c.muted};text-align:center;">${escapeHtml(opts.footnote)}</p>`
    : "";
  const ctas =
    opts.ctaPrimary || opts.ctaSecondary
      ? `<tr>
          <td style="padding:6px 32px 30px;text-align:center;">
            ${opts.ctaPrimary ? emailButton(opts.ctaPrimary.href, opts.ctaPrimary.label, "primary") : ""}
            ${opts.ctaSecondary ? emailButton(opts.ctaSecondary.href, opts.ctaSecondary.label, "secondary") : ""}
          </td>
        </tr>`
      : "";
  const site = siteUrl();
  const siteLabel = site.replace(/^https?:\/\//, "");
  const waDigits = WHATSAPP_NUMBER.replace(/[^0-9]/g, "");

  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(opts.title)}</title>
  <!--[if mso]><style type="text/css">body,table,td,a{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${c.linen};font-family:${fontSans};color:${c.ink};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;">${preheader}&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${c.linen};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;background-color:${c.paper};border-radius:22px;overflow:hidden;">
          <!-- Header band — the site's dark mark -->
          <tr>
            <td style="padding:34px 36px 30px;text-align:center;background-color:${c.ink};">
              <p style="margin:0;font-family:${fontSans};font-size:40px;font-weight:700;letter-spacing:-0.03em;line-height:1;color:${c.linen};">DB<span style="color:${c.terracotta};">.</span></p>
              <p style="margin:16px 0 0;font-family:${fontSans};font-size:13px;font-weight:600;letter-spacing:0.26em;text-transform:uppercase;color:#ffffff;">${escapeHtml(BRAND.name)}</p>
              <p style="margin:7px 0 0;font-family:${fontSans};font-size:9px;letter-spacing:0.32em;text-transform:uppercase;color:${c.sand};">Maestra en PNL</p>
            </td>
          </tr>
          <tr>
            <td style="height:3px;background-color:${c.terracotta};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:36px 36px 8px;">
              ${eyebrow}
              <h1 style="margin:0 0 18px;font-family:${fontSans};font-size:25px;font-weight:700;line-height:1.25;letter-spacing:-0.01em;color:${c.ink};text-align:center;">${escapeHtml(opts.title)}</h1>
              ${intro}
              <div style="font-family:${fontSans};font-size:15px;line-height:1.7;color:#33302b;">${opts.bodyHtml}</div>
              ${summary}
              ${footnote}
            </td>
          </tr>
          ${ctas}
          <!-- Footer -->
          <tr>
            <td style="padding:26px 36px 34px;text-align:center;border-top:1px solid ${c.line};background-color:${c.paper};">
              <p style="margin:0 0 8px;font-family:${fontSans};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${c.muted};">${escapeHtml(BRAND.shortName)}</p>
              <p style="margin:0 0 10px;font-family:${fontSans};font-size:12px;">
                <a href="${escapeHtml(site)}" style="color:${c.ink};text-decoration:none;border-bottom:1px solid ${c.sand};">${escapeHtml(siteLabel)}</a>
                &nbsp;&middot;&nbsp;
                <a href="mailto:contacto@dayanabeltran.com" style="color:${c.ink};text-decoration:none;border-bottom:1px solid ${c.sand};">contacto@dayanabeltran.com</a>
              </p>
              <p style="margin:0;font-family:${fontSans};font-size:11px;color:${c.muted};">WhatsApp ${escapeHtml(WHATSAPP_NUMBER)} &middot; <a href="https://wa.me/${waDigits}" style="color:${c.terracotta};text-decoration:none;">escribir</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

export const varsToPlainParagraphs = (lines: string[]): string =>
  lines
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#33302b;">${line}</p>`
    )
    .join("");

/** Mensaje precargado para CTA WhatsApp en confirmación de pago */
export const paymentWhatsAppHref = (firstName: string, productTitle: string): string =>
  buildWhatsAppUrl(
    `Hola Dayana, soy ${firstName}. Acabo de pagar ${productTitle} y quiero coordinar mi primera sesión.`
  );
