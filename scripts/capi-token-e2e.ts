/**
 * Compra → Meta cuando el token de la Conversions API no sirve, contra la base
 * de DESARROLLO. La Graph API se simula (nada sale de verdad).
 *
 * Producción dejó varios «The access token could not be decrypted» (código
 * 190) en el step `meta-capi-purchase` de `payment-approved`: Inngest lo
 * reintentaba, marcaba fallida la función entera y nadie se enteraba de que
 * Meta no recibía las compras. Comprueba que ahora:
 *
 * - un 190 termina el step como «omitido» (no se reintenta), deja `capiSentAt`
 *   vacío —la compra se podrá reenviar con el token bueno— y avisa al equipo;
 * - el aviso es UNO al día, no uno por compra;
 * - cualquier otro fallo (500) sigue subiendo para que Inngest reintente;
 * - con un token bueno la compra sale y queda sellada.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/capi-token-e2e.ts
 */
import { PaymentProvider, PaymentStatus } from "@prisma/client";

import { deleteSiteSetting } from "@/lib/crm/site-settings";
import { prisma } from "@/lib/db";
import { sendPurchaseToMetaCapi } from "@/lib/meta/capi-purchase";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NEXT_PUBLIC_META_PIXEL_ID = "999000111";
process.env.META_CAPI_ACCESS_TOKEN = "EAAE2E-token-falso";
process.env.NOTIFICATIONS_DRY_RUN = "true";
delete process.env.INNGEST_EVENT_KEY;
delete process.env.INNGEST_SIGNING_KEY;
process.env.INNGEST_DEV = "http://127.0.0.1:9";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

type Mode = "token" | "server" | "ok";
let mode: Mode = "token";
let graphCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://graph.facebook.com")) return realFetch(input, init);
  graphCalls += 1;
  if (mode === "ok") return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  if (mode === "server") return new Response("boom", { status: 500 });
  return new Response(
    JSON.stringify({ error: { message: "The access token could not be decrypted", code: 190, type: "OAuthException", fbtrace_id: "e2e-trace" } }),
    { status: 401 },
  );
}) as typeof fetch;

const run = Date.now();
const t0 = new Date();
const created = { contactId: "" };

const alerts = () =>
  prisma.platformNotification.findMany({
    where: { eventType: "SYSTEM_ALERT", entityType: "MetaCapi", createdAt: { gte: t0 } },
    select: { title: true },
  });

const newPurchase = async (suffix: string) => {
  const product = await prisma.product.findFirstOrThrow({ select: { id: true } });
  const enrollment = await prisma.enrollment.create({
    data: { contactId: created.contactId, productId: product.id, status: "ACTIVE", label: `E2E CAPI ${suffix}` },
    select: { id: true },
  });
  const payment = await prisma.payment.create({
    data: {
      enrollmentId: enrollment.id,
      provider: PaymentProvider.MANUAL,
      providerPaymentId: `e2e-capi-${run}-${suffix}`,
      status: PaymentStatus.APPROVED,
      currency: "USD",
      amountMinor: 10000,
      paidAt: new Date(),
    },
    select: { id: true },
  });
  return { enrollmentId: enrollment.id, paymentId: payment.id };
};

const main = async () => {
  await deleteSiteSetting("meta.capi.token_alert_day");
  const contact = await prisma.contact.create({
    data: {
      phoneE164: `+1557${String(run).slice(-7)}`,
      firstName: "E2E CAPI",
      email: `e2e-capi-${run}@example.com`,
      source: "OTHER",
      consentAdTrackingAt: new Date(),
    },
    select: { id: true },
  });
  created.contactId = contact.id;

  console.log("— Token que Meta rechaza (190)");
  const a = await newPurchase("a");
  mode = "token";
  const r1 = await sendPurchaseToMetaCapi(a.enrollmentId);
  check("el step termina como «omitido», no lanza", r1.status === "skipped" && r1.reason === "token_invalid", r1);
  const pa = await prisma.payment.findUniqueOrThrow({ where: { id: a.paymentId }, select: { capiSentAt: true } });
  check("capiSentAt queda vacío (se podrá reenviar con el token bueno)", pa.capiSentAt === null);
  const first = await alerts();
  check("el equipo recibe el aviso", first.length === 1 && /Meta/.test(first[0].title), first);

  console.log("\n— Una segunda compra el mismo día");
  const b = await newPurchase("b");
  const r2 = await sendPurchaseToMetaCapi(b.enrollmentId);
  check("también se omite", r2.status === "skipped" && r2.reason === "token_invalid", r2);
  check("pero NO duplica el aviso (uno al día)", (await alerts()).length === 1, (await alerts()).length);

  console.log("\n— Otro fallo (500): sigue subiendo para que Inngest reintente");
  mode = "server";
  let threw = false;
  try {
    await sendPurchaseToMetaCapi(b.enrollmentId);
  } catch {
    threw = true;
  }
  check("un 500 lanza como antes", threw);
  check("y no gasta el aviso diario", (await alerts()).length === 1);

  console.log("\n— Token bueno");
  mode = "ok";
  graphCalls = 0;
  const r3 = await sendPurchaseToMetaCapi(a.enrollmentId);
  check("la compra sale", r3.status === "sent", r3);
  const pa2 = await prisma.payment.findUniqueOrThrow({ where: { id: a.paymentId }, select: { capiSentAt: true } });
  check("y queda sellada", pa2.capiSentAt !== null);
  check("con una sola llamada a Meta", graphCalls === 1, graphCalls);
  const r4 = await sendPurchaseToMetaCapi(a.enrollmentId);
  check("un reintento no la cuenta dos veces", r4.status === "skipped" && r4.reason === "already_sent", r4);
};

const cleanup = async () => {
  globalThis.fetch = realFetch;
  await deleteSiteSetting("meta.capi.token_alert_day").catch(() => undefined);
  await prisma.platformNotification.deleteMany({ where: { entityType: "MetaCapi", createdAt: { gte: t0 } } });
  // Borrar el contacto arrastra sus matrículas y pagos (cascada).
  if (created.contactId) await prisma.contact.deleteMany({ where: { id: created.contactId } });
};

main()
  .catch((e) => {
    console.error(e);
    failures.push(`excepción: ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("limpieza:", e));
    await prisma.$disconnect();
    console.log(failures.length ? `\n❌ ${failures.length} fallo(s):\n - ${failures.join("\n - ")}` : "\n✅ Todo en orden");
    process.exit(failures.length ? 1 : 0);
  });
