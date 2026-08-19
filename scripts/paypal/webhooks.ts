/**
 * Inventario y sincronización de los webhooks de PayPal.
 *
 *   bun run scripts/paypal/webhooks.ts            # sólo mira y compara
 *   bun run scripts/paypal/webhooks.ts --sync URL # crea/actualiza los eventos
 *
 * Con `bun run`, no `bunx tsx`: bun carga `.env` solo y el script necesita las
 * credenciales del entorno que va a inspeccionar.
 *
 * ## Por qué existe
 *
 * Producción y desarrollo son cuentas distintas de PayPal (live y sandbox), así
 * que sus webhooks no pueden mezclarse... salvo por una cosa: **el
 * `PAYPAL_WEBHOOK_ID` del `.env`**. Ese id se usa para verificar la firma, y si
 * apunta al webhook del otro entorno —o a uno borrado— PayPal responde FAILURE
 * a todo, la ruta devuelve 401 y ningún pago se registra. Pasó en producción y
 * costó caro, porque el síntoma (entregas fallidas) no dice la causa.
 *
 * Este script compara lo que hay en la cuenta contra lo que dice tu `.env` y lo
 * canta. `--sync` deja exactamente un webhook con todos los eventos que el
 * handler sabe manejar y te dice qué id poner.
 */

const EVENTS = [
  // Órdenes: pago suelto de terapias y talleres.
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.ORDER.COMPLETED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  // Suscripciones: la mensualidad.
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.REFUNDED",
] as const;

type Webhook = {
  id: string;
  url: string;
  event_types?: Array<{ name: string }>;
};

const isLive = () => process.env.PAYPAL_MODE?.toLowerCase() === "live";
const base = () =>
  isLive() ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

const token = async (): Promise<string> => {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Faltan PAYPAL_CLIENT_ID/SECRET en .env");

  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) {
    throw new Error(`No autentica en ${isLive() ? "LIVE" : "SANDBOX"}: ${json.error_description ?? "?"}`);
  }
  return json.access_token;
};

const call = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json as Record<string, unknown>;
};

async function main() {
  const syncIdx = process.argv.indexOf("--sync");
  const targetUrl = syncIdx >= 0 ? process.argv[syncIdx + 1] : undefined;
  const entorno = isLive() ? "LIVE (producción)" : "SANDBOX (desarrollo)";
  const configured = process.env.PAYPAL_WEBHOOK_ID?.trim();

  console.log(`Entorno (PAYPAL_MODE) : ${entorno}`);
  console.log(`PAYPAL_WEBHOOK_ID     : ${configured || "(sin definir)"}\n`);

  const listed = (await call("/v1/notifications/webhooks")) as unknown as {
    webhooks?: Webhook[];
  };
  const webhooks = listed.webhooks ?? [];

  if (webhooks.length === 0) console.log("No hay webhooks registrados.\n");
  for (const w of webhooks) {
    const names = (w.event_types ?? []).map((e) => e.name);
    const faltan = EVENTS.filter((e) => !names.includes(e));
    console.log(`  ${w.id === configured ? "✔ EN USO" : "  otro   "}  ${w.id}`);
    console.log(`            ${w.url}`);
    console.log(`            ${names.length} eventos` + (faltan.length ? ` · FALTAN: ${faltan.join(", ")}` : " · cubre todo lo que el handler maneja"));
  }

  if (configured && !webhooks.some((w) => w.id === configured)) {
    console.log(
      `\n  PROBLEMA: PAYPAL_WEBHOOK_ID no existe en esta cuenta.\n` +
        `  La verificación de firma fallará SIEMPRE y ningún pago se registrará.\n` +
        `  Suele ser el id del otro entorno. Pon uno de los de arriba.`
    );
  }

  if (!targetUrl) {
    console.log("\n(Sólo lectura. Usa --sync <url> para crear o actualizar.)");
    return;
  }

  const existing = webhooks.find((w) => w.url === targetUrl);
  if (existing) {
    await call(`/v1/notifications/webhooks/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify([
        { op: "replace", path: "/event_types", value: EVENTS.map((name) => ({ name })) },
      ]),
    });
    console.log(`\nActualizado ${existing.id} con los ${EVENTS.length} eventos.`);
    console.log(`PAYPAL_WEBHOOK_ID=${existing.id}`);
    return;
  }

  const created = await call("/v1/notifications/webhooks", {
    method: "POST",
    body: JSON.stringify({ url: targetUrl, event_types: EVENTS.map((name) => ({ name })) }),
  });
  console.log(`\nCreado ${created.id} -> ${targetUrl}`);
  console.log(`PAYPAL_WEBHOOK_ID=${created.id}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
