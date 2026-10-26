/**
 * Webhook de Mercado Pago: qué avisa y qué no, contra la base de DESARROLLO.
 *
 * Desde el 19-oct producción acumuló 13 alertas «rechazado por firma inválida»
 * con «Recurso desconocido». La causa más probable: Mercado Pago manda además
 * del webhook firmado la notificación legada (IPN: `topic` + `resource`, sin
 * `x-signature`), que nunca puede verificarse. Se rechazaba bien, pero cada una
 * despertaba a todo el equipo.
 *
 * Comprueba que ahora:
 * - una entrega SIN firma sigue respondiendo 401 (es lo que usa el chequeo
 *   rápido del CLAUDE.md para saber que la URL alcanza la función);
 * - si en las últimas 6 h SÍ entró un webhook firmado, lo sin firma es el IPN
 *   duplicado: no avisa y queda en la auditoría con el id leído del formato
 *   legado o de la URL;
 * - si NO entró ninguno firmado, eso ya es señal de que MP dejó de firmar o el
 *   panel apunta mal: avisa, pero UNA vez al día;
 * - una entrega CON firma pero inválida responde 401 y SÍ avisa, con el id.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/webhook-alerts-e2e.ts
 */
import { PaymentProvider } from "@prisma/client";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/webhooks/mercadopago/route";
import { deleteSiteSetting } from "@/lib/crm/site-settings";
import { prisma } from "@/lib/db";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.MERCADOPAGO_WEBHOOK_SECRET = "secreto-de-prueba-e2e";
process.env.NOTIFICATIONS_DRY_RUN = "true";
// El margen real es de 45 s para que el firmado del mismo pago alcance a
// registrarse; en la prueba basta una fracción.
process.env.MP_UNSIGNED_GRACE_MS = "300";
delete process.env.INNGEST_EVENT_KEY;
delete process.env.INNGEST_SIGNING_KEY;
process.env.INNGEST_DEV = "http://127.0.0.1:9";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const UNSIGNED_DAY_SETTING = "mp.webhook.unsigned_alert_day";
const t0 = new Date();
const run = Date.now();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alerts = () =>
  prisma.platformNotification.findMany({
    where: { eventType: "PAYMENT_WEBHOOK_FAILED", createdAt: { gte: t0 } },
    select: { title: true, body: true, metadata: true },
  });
const audits = () =>
  prisma.auditLog.findMany({
    where: { action: "WEBHOOK_REJECTED", entityId: "mercadopago", createdAt: { gte: t0 } },
    select: { changes: true },
  });
const waitForAlerts = async (n: number) => {
  for (let i = 0; i < 24; i++) {
    const r = await alerts();
    if (r.length >= n) return r;
    await wait(500);
  }
  return alerts();
};

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

const main = async () => {
  await deleteSiteSetting(UNSIGNED_DAY_SETTING);
  const recentSigned = await prisma.webhookEvent.count({
    where: { provider: PaymentProvider.MERCADO_PAGO, processedAt: { gte: new Date(Date.now() - 6 * 3600_000) } },
  });
  if (recentSigned > 0) console.log(`  (ya hay ${recentSigned} webhooks firmados recientes en dev: se omite el grupo «sin ninguno firmado»)`);

  console.log("— Entrega SIN firma, con un webhook firmado reciente (el IPN duplicado de siempre)");
  await prisma.webhookEvent.create({
    data: { provider: PaymentProvider.MERCADO_PAGO, eventId: `e2e-firmado-${run}`, payload: {} },
  });
  const ipn = await post("/api/webhooks/mercadopago", {
    resource: "https://api.mercadolibre.com/collections/notifications/1234567890",
    topic: "payment",
  });
  check("responde 401 (el chequeo rápido sigue valiendo)", ipn.status === 401, ipn.status);
  const empty = await post("/api/webhooks/mercadopago", {});
  check("un POST vacío también da 401", empty.status === 401, empty.status);
  await post("/api/webhooks/mercadopago?topic=payment&id=987654", {});
  await wait(1500);
  check("NO avisa al equipo", (await alerts()).length === 0, (await alerts()).length);
  const a1 = await audits();
  check("queda en la auditoría con su motivo", a1.some((a) => (a.changes as { reason?: string })?.reason === "unsigned_delivery"), a1);
  check("con el id leído del formato legado", a1.some((a) => (a.changes as { resourceId?: string })?.resourceId === "1234567890"), a1.map((a) => a.changes));
  check("y con el id leído de la URL", a1.some((a) => (a.changes as { resourceId?: string })?.resourceId === "987654"));

  if (recentSigned === 0) {
    console.log("\n— Entrega SIN firma y NINGÚN webhook firmado en 6 h (MP dejó de firmar, o el panel apunta mal)");
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "e2e-firmado-" } } });
    // Los IPN llegan en ráfaga y cada uno lanza su propia comprobación: el
    // «una vez al día» tiene que aguantar a seis a la vez, no leer-y-escribir.
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        post("/api/webhooks/mercadopago", { resource: `https://api.mercadolibre.com/collections/notifications/${55 + i}`, topic: "payment" }),
      ),
    );
    const first = await waitForAlerts(1);
    await wait(1500);
    const firstFinal = await alerts();
    check("SÍ avisa", first.length >= 1, first.length);
    check("y seis a la vez dan EXACTAMENTE UN aviso", firstFinal.length === 1, firstFinal.length);
    check("y dice qué revisar", /webhook/i.test(first[0]?.body ?? "") && /firmado/i.test(first[0]?.body ?? ""), first[0]?.body);
    await post("/api/webhooks/mercadopago", { resource: "https://api.mercadolibre.com/collections/notifications/56", topic: "payment" });
    await wait(1500);
    check("pero UNA sola vez al día", (await alerts()).length === 1, (await alerts()).length);
  }

  console.log("\n— Entrega CON firma que no cuadra");
  const before = (await alerts()).length;
  const signed = await post(
    "/api/webhooks/mercadopago",
    { id: 1, type: "payment", data: { id: "55555" } },
    {
      "x-signature": `ts=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
      "x-request-id": "e2e-req-1",
    },
  );
  check("responde 401", signed.status === 401, signed.status);
  const rows = await waitForAlerts(before + 1);
  const mine = rows.filter((r) => /55555/.test(r.body ?? ""));
  check("SÍ avisa al equipo (es un remitente que firma con otro secreto)", mine.length === 1, rows.length);
  check("con el id del recurso", /55555/.test(mine[0]?.body ?? ""), mine[0]?.body);
  check("y la auditoría lo marca como firma inválida", (await audits()).some((a) => (a.changes as { reason?: string })?.reason === "invalid_signature"));
};

const cleanup = async () => {
  await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "e2e-firmado-" } } });
  await deleteSiteSetting(UNSIGNED_DAY_SETTING).catch(() => undefined);
  await prisma.platformNotification.deleteMany({ where: { eventType: "PAYMENT_WEBHOOK_FAILED", createdAt: { gte: t0 } } });
  await prisma.auditLog.deleteMany({ where: { action: "WEBHOOK_REJECTED", entityId: "mercadopago", createdAt: { gte: t0 } } });
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
