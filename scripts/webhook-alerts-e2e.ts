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
 *   rápido del CLAUDE.md para saber que la URL alcanza la función) y no avisa;
 * - una entrega CON firma pero inválida responde 401 y SÍ avisa, con el id del
 *   recurso;
 * - el id del recurso se lee también del formato legado y de la URL.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/webhook-alerts-e2e.ts
 */
import { NextRequest } from "next/server";

import { POST } from "@/app/api/webhooks/mercadopago/route";
import { prisma } from "@/lib/db";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.MERCADOPAGO_WEBHOOK_SECRET = "secreto-de-prueba-e2e";
process.env.NOTIFICATIONS_DRY_RUN = "true";
delete process.env.INNGEST_EVENT_KEY;
delete process.env.INNGEST_SIGNING_KEY;
process.env.INNGEST_DEV = "http://127.0.0.1:9";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const t0 = new Date();
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

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

const main = async () => {
  console.log("— Entrega SIN firma (la notificación legada)");
  const ipn = await post("/api/webhooks/mercadopago", {
    resource: "https://api.mercadolibre.com/collections/notifications/1234567890",
    topic: "payment",
  });
  check("responde 401 (el chequeo rápido sigue valiendo)", ipn.status === 401, ipn.status);
  const empty = await post("/api/webhooks/mercadopago", {});
  check("un POST vacío también da 401", empty.status === 401, empty.status);
  await wait(1500);
  check("NO avisa al equipo", (await alerts()).length === 0, (await alerts()).length);
  const a1 = await audits();
  check("pero queda en la auditoría con su motivo", a1.some((a) => (a.changes as { reason?: string })?.reason === "unsigned_delivery"), a1);
  check(
    "y con el id leído del formato legado",
    a1.some((a) => (a.changes as { resourceId?: string })?.resourceId === "1234567890"),
    a1.map((a) => a.changes),
  );
  const viaQuery = await post("/api/webhooks/mercadopago?topic=payment&id=987654", {});
  await wait(800);
  check(
    "y lo lee de la URL cuando viene ahí",
    (await audits()).some((a) => (a.changes as { resourceId?: string })?.resourceId === "987654"),
  );

  console.log("\n— Entrega CON firma que no cuadra");
  const signed = await post(
    "/api/webhooks/mercadopago",
    { id: 1, type: "payment", data: { id: "55555" } },
    {
      "x-signature": `ts=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
      "x-request-id": "e2e-req-1",
    },
  );
  check("responde 401", signed.status === 401, signed.status);
  const rows = await (async () => {
    for (let i = 0; i < 20; i++) {
      const r = await alerts();
      if (r.length) return r;
      await wait(500);
    }
    return alerts();
  })();
  check("SÍ avisa al equipo (es un remitente que firma con otro secreto)", rows.length === 1, rows.length);
  check("con el id del recurso", /55555/.test(rows[0]?.body ?? ""), rows[0]?.body);
  check("y la auditoría lo marca como firma inválida", (await audits()).some((a) => (a.changes as { reason?: string })?.reason === "invalid_signature"));
  void viaQuery;
};

const cleanup = async () => {
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
