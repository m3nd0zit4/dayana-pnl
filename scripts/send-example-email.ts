/**
 * Envía correo de ejemplo (confirmación de pago) con diseño de marca.
 * Uso: bun --env-file=.env run scripts/send-example-email.ts [destino]
 * Default: julianestebanmb2007@gmail.com
 *
 * Requiere RESEND_API_KEY + dominio dayanabeltran.com verificado en Resend.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const loadEnv = () => {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
};
loadEnv();

import {
  paymentConfirmationHtml,
  paymentConfirmationSubject,
  paymentConfirmationText,
} from "../lib/notifications/templates/payment-confirmation";
import { sendEmail } from "../lib/notifications/channels/email";
import { emailFrom, emailProviderId, isDryRun } from "../lib/notifications/config";

const to =
  process.argv[2]?.trim() || "julianestebanmb2007@gmail.com";

const vars = {
  first_name: "Julia",
  last_name: "",
  display_name: "Julia",
  phone: "+573001234567",
  product_title: "Terapia 6 sesiones (ejemplo)",
  payment_amount: "USD 480.00",
  payment_currency: "USD",
  payment_provider: "PAYPAL",
  payment_date: new Date().toLocaleDateString("es-CO", { dateStyle: "long" }),
  sessions_total: "6",
  sessions_left: "6",
  site_url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://dayanabeltran.com",
  admin_contact_url: "https://dayanabeltran.com/admin/contacts",
};

async function main() {
  if (isDryRun()) {
    console.error(
      "NOTIFICATIONS_DRY_RUN=true. Pon NOTIFICATIONS_DRY_RUN=false en .env"
    );
    process.exit(1);
  }

  if (!emailProviderId()) {
    console.error(
      "Falta RESEND_API_KEY en .env.\n" +
        "1. https://resend.com → API Keys\n" +
        "2. Domains → añade dayanabeltran.com (DNS en Vercel)\n" +
        "3. docs/vercel-resend-email.md"
    );
    process.exit(1);
  }

  const from = emailFrom();
  const subject = `[Ejemplo] ${paymentConfirmationSubject(vars)}`;
  const result = await sendEmail({
    to,
    subject,
    html: paymentConfirmationHtml(vars),
    text: paymentConfirmationText(vars),
  });

  console.log(`Enviado desde ${from.email} → ${to} (${result.providerId})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
