/**
 * Deja el entorno de desarrollo apuntando al túnel de ngrok que esté vivo.
 *
 *   bun run scripts/dev/tunnel-sync.ts
 *
 * ## Por qué existe
 *
 * ngrok gratuito da una URL distinta en cada arranque, y de esa URL dependen
 * **tres** cosas que no están juntas:
 *
 *   1. `NEXT_PUBLIC_SITE_URL` — de ahí sale el `notification_url` de cada
 *      preferencia de Mercado Pago, y sólo se manda si la base es HTTPS y no
 *      es localhost.
 *   2. `DEV_ALLOWED_ORIGIN` — sin ella Next bloquea `/_next/*` desde ese host
 *      y los componentes de cliente NUNCA hidratan: el checkout aparece sin
 *      botones, como si la página estuviera rota. El síntoma no dice la causa.
 *   3. El webhook de PayPal, que además hay que podar: `--sync` crea uno nuevo
 *      y deja el anterior vivo acumulando entregas fallidas.
 *
 * Actualizarlas a mano funciona hasta que se te olvida una. Pasó con la 2.
 *
 * Lo que NO puede hacer este script: el webhook del panel de Mercado Pago es
 * configuración manual en su consola y no hay API para cambiarlo. Se imprime
 * al final para que se copie a mano.
 */

import { readFileSync, writeFileSync } from "node:fs";

const ENV_PATH = ".env";

const tunnelUrl = async (): Promise<string> => {
  const res = await fetch("http://127.0.0.1:4040/api/tunnels").catch(() => null);
  if (!res?.ok) {
    throw new Error(
      "ngrok no responde en 127.0.0.1:4040. Arráncalo primero:\n" +
        "  ngrok http 3000"
    );
  }
  const data = (await res.json()) as {
    tunnels?: { proto: string; public_url: string }[];
  };
  const https = data.tunnels?.find((t) => t.proto === "https");
  if (!https) throw new Error("ngrok está vivo pero no expone ningún túnel https.");
  return https.public_url.replace(/\/$/, "");
};

/**
 * Reemplaza el valor de una variable dejando el resto del fichero intacto.
 *
 * `.env` se mantiene a mano y tiene comentarios y claves que no están en
 * ningún otro sitio: se empalma, nunca se reescribe entero.
 */
const spliceEnv = (source: string, key: string, value: string): { next: string; before: string | null } => {
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const m = re.exec(source);
  if (!m) return { next: `${source.replace(/\s*$/, "")}\n${key}=${value}\n`, before: null };
  const before = m[1].trim();
  return {
    next: source.slice(0, m.index) + `${key}=${value}` + source.slice(m.index + m[0].length),
    before,
  };
};

const setEnv = (key: string, value: string) => {
  const source = readFileSync(ENV_PATH, "utf8");
  const { next, before } = spliceEnv(source, key, value);
  writeFileSync(ENV_PATH, next);
  if (before === value) console.log(`  = ${key} ya estaba al día`);
  else console.log(`  ✔ ${key}${before ? `\n      antes: ${before}` : " (añadida)"}\n      ahora: ${value}`);
};

async function main() {
  const url = await tunnelUrl();
  const host = new URL(url).host;

  console.log(`Túnel vivo: ${url}\n`);

  setEnv("NEXT_PUBLIC_SITE_URL", url);
  setEnv("DEV_ALLOWED_ORIGIN", host);

  console.log("\nPayPal:");
  const webhookUrl = `${url}/api/webhooks/paypal`;
  console.log(`  bun run scripts/paypal/webhooks.ts --sync ${webhookUrl}`);
  console.log(`  bun run scripts/paypal/webhooks.ts --prune ${webhookUrl}`);
  console.log("  (y pon el id que imprima en PAYPAL_WEBHOOK_ID)");

  console.log("\nMercado Pago — a mano, no hay API:");
  console.log("  Tus integraciones → la app → Webhooks → Modo productivo");
  console.log(`  URL: ${url}/api/webhooks/mercadopago`);
  console.log('  Marca «Pagos» Y «Planes y suscripciones»: sin el segundo la');
  console.log("  mensualidad se cobra y el CRM no se entera.");

  console.log(
    "\nReinicia `bun dev` DESPUÉS de esto: `NEXT_PUBLIC_SITE_URL` se inlinea\n" +
      "al compilar y `DEV_ALLOWED_ORIGIN` se lee al arrancar."
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
