/**
 * Pagos de la página que quedaron en la ficha temporal del checkout
 * («Pendiente», teléfono `+pending:`) aunque la persona ya tiene su ficha real
 * con su chat (Allison, 25-oct: pagó el taller por PSE con otro correo; Dayana
 * confirmó la captura en el chat de «Ana Milena Loaiza» y la inscrita seguía
 * como «Pendiente»).
 *
 * Mira los comprobantes confirmados enlazados a un pago cuya matrícula está en
 * una ficha temporal mientras el comprobante (o su chat) tiene una ficha real, y
 * pasa la matrícula a la real (`adoptPlaceholderContact`). También lista las
 * fichas temporales con un pago aprobado y ningún comprobante: esas solo las
 * puede identificar Dayana.
 *
 *   bun --env-file=.env scripts/adopt-checkout-placeholders.ts          # solo lista
 *   bun --env-file=.env scripts/adopt-checkout-placeholders.ts --apply  # corrige
 */
export {};

const main = async () => {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("@/lib/db");
  const { adoptPlaceholderContact } = await import("@/lib/crm/whatsapp-agent/receipts");

  const isPlaceholder = (c: { firstName: string; phoneE164: string }) => c.firstName === "Pendiente" || c.phoneE164.startsWith("+pending");

  const rows = await prisma.whatsAppPaymentReceipt.findMany({
    where: { status: "confirmed", paymentId: { not: null } },
    select: { id: true, contactId: true, paymentId: true, conversation: { select: { contactId: true, externalThreadId: true } } },
  });
  const payments = await prisma.payment.findMany({
    where: { id: { in: rows.map((r) => r.paymentId!) } },
    select: {
      id: true,
      providerPaymentId: true,
      enrollment: { select: { id: true, productId: true, contact: { select: { id: true, firstName: true, phoneE164: true, email: true } } } },
    },
  });
  const paymentOf = new Map(payments.map((p) => [p.id, p]));
  const receipts = rows.map((r) => ({ ...r, payment: paymentOf.get(r.paymentId!) ?? null }));
  let fixed = 0;
  for (const r of receipts) {
    const from = r.payment?.enrollment.contact;
    const realId = r.contactId ?? r.conversation.contactId;
    if (!from || !realId || from.id === realId || !isPlaceholder(from)) continue;
    const real = await prisma.contact.findUnique({ where: { id: realId }, select: { firstName: true, lastName: true, phoneE164: true } });
    if (!real || isPlaceholder(real)) continue;
    console.log(
      `${apply ? "→" : "·"} ${r.payment!.enrollment.productId} (pago ${r.payment!.providerPaymentId}): ficha temporal ${from.email ?? from.id} → ${[real.firstName, real.lastName].filter(Boolean).join(" ")} (${real.phoneE164}, chat ${r.conversation.externalThreadId})`
    );
    if (apply && (await adoptPlaceholderContact(from.id, realId, null))) fixed++;
  }

  const orphans = await prisma.contact.findMany({
    where: {
      OR: [{ firstName: "Pendiente" }, { phoneE164: { startsWith: "+pending" } }],
      enrollments: { some: { payments: { some: { status: "APPROVED" } } } },
    },
    select: { id: true, firstName: true, lastName: true, email: true, enrollments: { select: { productId: true, payments: { where: { status: "APPROVED" }, select: { provider: true, amountMinor: true, currency: true, paidAt: true } } } } },
  });
  const unnamed = orphans.filter((c) => c.firstName === "Pendiente");
  if (unnamed.length) {
    console.log("\nFichas «Pendiente» con un pago aprobado (solo Dayana sabe quién es):");
    for (const c of unnamed) {
      for (const e of c.enrollments) {
        for (const p of e.payments) console.log(`  · ${c.email ?? c.id} — ${e.productId} — ${p.provider} ${p.amountMinor} ${p.currency} — ${p.paidAt?.toISOString().slice(0, 10) ?? "?"}`);
      }
    }
  }
  console.log(apply ? `\nCorregidas: ${fixed}` : "\nSolo lista. Con --apply se corrigen las de arriba con «→».");
  await prisma.$disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
