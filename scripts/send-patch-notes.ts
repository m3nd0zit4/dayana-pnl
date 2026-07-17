/**
 * Envía las notas de versión de un deploy a producción.
 * Uso: bun run scripts/send-patch-notes.ts <archivo.html> [destino] [asunto]
 * Default destino: dianamilenabr2007@gmail.com (Dayana)
 *
 * Regla del proyecto: cada push a main (producción) va acompañado de un
 * correo a Dayana con el patch note completo del deploy.
 * Requiere RESEND_API_KEY en .env y NOTIFICATIONS_DRY_RUN=false.
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

import { sendEmail } from "../lib/notifications/channels/email";
import { emailFrom, emailProviderId, isDryRun } from "../lib/notifications/config";

const htmlPath = process.argv[2]?.trim();
const to = process.argv[3]?.trim() || "dianamilenabr2007@gmail.com";
const subject =
  process.argv[4]?.trim() ||
  `Actualización de dayanabeltran.com — ${new Date().toLocaleDateString("es-CO", { dateStyle: "long" })}`;

async function main() {
  if (!htmlPath || !existsSync(htmlPath)) {
    console.error(
      "Uso: bun run scripts/send-patch-notes.ts <archivo.html> [destino] [asunto]"
    );
    process.exit(1);
  }
  if (isDryRun()) {
    console.error("NOTIFICATIONS_DRY_RUN=true — pon false en .env para enviar.");
    process.exit(1);
  }
  if (!emailProviderId()) {
    console.error("Falta RESEND_API_KEY (o SMTP_*) en .env.");
    process.exit(1);
  }

  const html = readFileSync(resolve(htmlPath), "utf8");
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const from = emailFrom();
  const result = await sendEmail({ to, subject, html, text });
  console.log(
    `Patch notes enviadas desde ${from.email} → ${to} (${result.providerId}${result.messageId ? `, id ${result.messageId}` : ""})`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
