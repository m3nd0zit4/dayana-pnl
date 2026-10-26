/**
 * Reenvía a Meta las compras que quedaron sin enviar por culpa del token.
 *
 * Cuando el token de la Conversions API falla, `sendPurchaseToMetaCapi` termina
 * como «omitido» y deja `capiSentAt` vacío, pero nada vuelve a intentarlo solo
 * (los pagos no pasan de nuevo por `payment-approved`). Este script los recoge:
 * pagos APROBADOS de los últimos 7 días —Meta no acepta eventos más viejos—,
 * de personas que dieron consentimiento publicitario (el mismo filtro de
 * `capi-purchase.ts`: sin consentimiento nunca se envía) y sin `capiSentAt`.
 *
 * Por defecto SOLO LISTA. Para enviar, `--send`, y sólo después de haber puesto
 * el token nuevo. Es idempotente: `sendPurchaseToMetaCapi` sella `capiSentAt` y
 * Meta cuenta una compra por `event_id`, así que repetirlo no duplica.
 *
 *   bun --env-file=<entorno> scripts/capi-resend-unsent.ts           # lista
 *   bun --env-file=<entorno> scripts/capi-resend-unsent.ts --send    # envía
 */
import { PaymentStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { sendPurchaseToMetaCapi } from "@/lib/meta/capi-purchase";

const SEND = process.argv.includes("--send");
const WINDOW_DAYS = 7;

const main = async () => {
  const dbName = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").pathname.replace("/", "");
    } catch {
      return "(desconocida)";
    }
  })();
  console.log(`Base: ${dbName} · ${SEND ? "ENVÍA" : "solo lista (sin --send)"}`);

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const pending = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.APPROVED,
      capiSentAt: null,
      paidAt: { gte: since },
      enrollment: { contact: { consentAdTrackingAt: { not: null } } },
    },
    orderBy: { paidAt: "asc" },
    select: { id: true, enrollmentId: true, paidAt: true, currency: true, amountMinor: true },
  });

  // `sendPurchaseToMetaCapi` trabaja por MATRÍCULA y envía su ÚLTIMO pago
  // aprobado. Un pago más antiguo de una matrícula con otro posterior no se
  // puede reenviar por esta vía (saldría reportado como «ya enviado» o se
  // enviaría el otro): se separa y se dice.
  const sendable: typeof pending = [];
  const superseded: typeof pending = [];
  for (const p of pending) {
    const latest = await prisma.payment.findFirst({
      where: { enrollmentId: p.enrollmentId, status: PaymentStatus.APPROVED },
      orderBy: { paidAt: "desc" },
      select: { id: true },
    });
    (latest?.id === p.id ? sendable : superseded).push(p);
  }

  console.log(`Compras con consentimiento, sin enviar, de los últimos ${WINDOW_DAYS} días: ${pending.length}`);
  for (const p of sendable) {
    console.log(` - pago ${p.id} · ${p.paidAt?.toISOString()} · ${p.currency} ${p.amountMinor}`);
  }
  for (const p of superseded) {
    console.log(` - pago ${p.id} · NO se puede reenviar con este script: su matrícula tiene un pago más reciente (súbelo a mano en Events Manager)`);
  }
  if (!SEND || sendable.length === 0) return;

  let sent = 0;
  for (const p of sendable) {
    try {
      const r = await sendPurchaseToMetaCapi(p.enrollmentId);
      const ok = r.status === "sent";
      if (ok) sent += 1;
      console.log(`   ${ok ? "✅" : "⚠️ "} ${p.id}: ${r.status}${r.status === "skipped" ? ` (${r.reason})` : ""}`);
      // Si el token sigue mal, el siguiente fallaría igual: se para.
      if (r.status === "skipped" && r.reason === "token_invalid") {
        console.log("   El token sigue siendo inválido: se detiene.");
        break;
      }
    } catch (e) {
      console.log(`   ❌ ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`Enviadas: ${sent} de ${sendable.length}`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
