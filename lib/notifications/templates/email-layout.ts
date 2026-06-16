import { BRAND, WHATSAPP_NUMBER, buildWhatsAppUrl } from "@/lib/contact";
import { siteUrl } from "../config";

export const BRAND_EMAIL = {
  ink: "#0a0a0a",
  paper: "#ffffff",
  linen: "#ece3d4",
  blush: "#edc3b1",
  sand: "#d4b896",
  muted: "#5c5c5c",
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
  title: string;
  introHtml?: string;
  bodyHtml: string;
  summaryRows?: SummaryRow[];
  ctaPrimary?: { label: string; href: string };
  ctaSecondary?: { label: string; href: string };
};

const fontSerif =
  "Georgia, 'Times New Roman', 'Palatino Linotype', serif";
const fontSans =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const emailButton = (
  href: string,
  label: string,
  variant: "primary" | "secondary" = "primary"
): string => {
  const isPrimary = variant === "primary";
  const bg = isPrimary ? BRAND_EMAIL.ink : BRAND_EMAIL.paper;
  const color = isPrimary ? BRAND_EMAIL.paper : BRAND_EMAIL.ink;
  const border = isPrimary ? BRAND_EMAIL.ink : BRAND_EMAIL.sand;
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${bg};color:${color};text-decoration:none;padding:14px 26px;border-radius:999px;font-family:${fontSans};font-size:14px;font-weight:600;letter-spacing:0.03em;border:1px solid ${border};margin:4px 6px;">${escapeHtml(label)}</a>`;
};

export const summaryCardHtml = (rows: SummaryRow[]): string => {
  const items = rows
    .map((row) => {
      const valueStyle = row.highlight
        ? `font-size:18px;font-weight:600;color:${BRAND_EMAIL.ink};`
        : `font-size:15px;color:${BRAND_EMAIL.ink};`;
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BRAND_EMAIL.linen};font-family:${fontSans};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND_EMAIL.muted};width:38%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid ${BRAND_EMAIL.linen};${valueStyle}font-family:${fontSerif};vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0 8px;background:${BRAND_EMAIL.linen};border-radius:14px;border:1px solid ${BRAND_EMAIL.linenDark};">
    <tr><td style="padding:18px 20px;">${items}</td></tr>
  </table>`;
};

export const wrapEmailHtml = (opts: EmailLayoutOptions): string => {
  const c = BRAND_EMAIL;
  const preheader = escapeHtml(opts.preheader ?? opts.title);
  const summary = opts.summaryRows?.length
    ? summaryCardHtml(opts.summaryRows)
    : "";
  const intro = opts.introHtml ?? "";
  const ctas =
    opts.ctaPrimary || opts.ctaSecondary
      ? `<tr>
          <td style="padding:8px 32px 28px;text-align:center;">
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
  <!--[if mso]><style type="text/css">body,table,td{font-family:Georgia,serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${c.linen};font-family:${fontSerif};color:${c.ink};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;">${preheader}&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${c.linen};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;background-color:${c.paper};border-radius:24px;overflow:hidden;border:1px solid ${c.linenDark};">
          <tr>
            <td style="height:5px;background-color:${c.blush};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:36px 36px 12px;text-align:center;background-color:${c.paper};">
              <p style="margin:0 0 6px;font-family:${fontSans};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${c.sand};">${escapeHtml(BRAND.tagline)}</p>
              <h1 style="margin:0;font-family:${fontSerif};font-size:28px;font-weight:400;line-height:1.2;color:${c.ink};letter-spacing:-0.02em;">${escapeHtml(BRAND.name)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 36px 0;text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                <tr>
                  <td style="width:52px;height:52px;border-radius:50%;background-color:${c.linen};text-align:center;vertical-align:middle;font-size:22px;line-height:52px;color:${c.ink};">✓</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 36px 8px;">
              <h2 style="margin:0 0 12px;font-family:${fontSerif};font-size:22px;font-weight:500;line-height:1.3;color:${c.ink};text-align:center;">${escapeHtml(opts.title)}</h2>
              ${intro}
              <div style="font-family:${fontSerif};font-size:16px;line-height:1.7;color:${c.ink};">${opts.bodyHtml}</div>
              ${summary}
            </td>
          </tr>
          ${ctas}
          <tr>
            <td style="padding:28px 36px 36px;text-align:center;border-top:1px solid ${c.linen};background-color:${c.paper};">
              <p style="margin:0 0 6px;font-family:${fontSans};font-size:12px;color:${c.muted};">${escapeHtml(BRAND.shortName)}</p>
              <p style="margin:0 0 10px;font-family:${fontSans};font-size:12px;">
                <a href="${escapeHtml(site)}" style="color:${c.ink};text-decoration:underline;">${escapeHtml(siteLabel)}</a>
                &nbsp;·&nbsp;
                <a href="mailto:contacto@dayanabeltran.com" style="color:${c.ink};text-decoration:underline;">contacto@dayanabeltran.com</a>
              </p>
              <p style="margin:0;font-family:${fontSans};font-size:11px;color:${c.muted};">WhatsApp ${escapeHtml(WHATSAPP_NUMBER)} · <a href="https://wa.me/${waDigits}" style="color:${c.sand};text-decoration:none;">escribir</a></p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-family:${fontSans};font-size:11px;color:${c.muted};text-align:center;">Este correo es informativo. Si no realizaste este pago, contáctanos.</p>
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
        `<p style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:${BRAND_EMAIL.ink};">${line}</p>`
    )
    .join("");

/** Mensaje precargado para CTA WhatsApp en confirmación de pago */
export const paymentWhatsAppHref = (firstName: string, productTitle: string): string =>
  buildWhatsAppUrl(
    `Hola Dayana, soy ${firstName}. Acabo de pagar ${productTitle} y quiero coordinar mi primera sesión.`
  );
