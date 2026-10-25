/**
 * El comprobante de un pago que ya entró solo por la página (Gina, 25-oct):
 * pagó el taller por PSE con el enlace, Mercado Pago lo aprobó y la inscribió,
 * y después mandó la captura por WhatsApp desde un chat sin número (usuario de
 * WhatsApp). Contra la base de DESARROLLO; todo se borra al final.
 *
 *   bun --env-file=.env scripts/whatsapp-receipt-web-payment-e2e.ts
 *
 * 1. La tarjeta lo reconoce por la referencia (id del pago en Mercado Pago).
 * 2. Confirmar: el chat queda vinculado a la ficha del pago (sin número), la
 *    ficha temporal «Pendiente» toma el nombre del comprobante, el comprobante
 *    queda enlazado al pago y no pide registrarlo.
 * 3. Otro comprobante con otra referencia: no se reconoce.
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  const { prisma } = await import("@/lib/db");
  const { listReceipts } = await import("@/lib/crm/whatsapp-agent/payment-info");
  const { decideReceipt } = await import("@/lib/crm/whatsapp-agent/receipts");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
  };

  const run = Date.now().toString().slice(-6);
  const ref = `9${run}161400`;
  const product = await prisma.product.findFirst({ where: { id: { startsWith: "taller-" } }, select: { id: true } });
  if (!product) throw new Error("Falta un producto de taller en desarrollo.");
  const contact = await prisma.contact.create({
    data: { phoneE164: `+pending:e2e-${run}`, firstName: "Pendiente", email: `e2e-recibo-${run}@example.com`, sourceDetail: "checkout:e2e" },
  });
  const enrollment = await prisma.enrollment.create({ data: { contactId: contact.id, productId: product.id, status: "ACTIVE" } });
  const payment = await prisma.payment.create({
    data: { enrollmentId: enrollment.id, provider: "MERCADO_PAGO", providerPaymentId: ref, status: "APPROVED", currency: "COP", amountMinor: 199475 },
  });
  const conv = await prisma.conversation.create({
    data: { channel: "WHATSAPP", externalThreadId: `CO.e2e${run}`, metaAccountId: "test-phone-id", participantName: "Gina Catalina" },
  });
  const receipt = await prisma.whatsAppPaymentReceipt.create({
    data: {
      conversationId: conv.id,
      status: "pending",
      method: "PSE (BBVA / Mercadopago)",
      amountMinor: 199475,
      currency: "COP",
      reference: ref,
      payerName: "Gina Catalina Sánchez Delgado",
      summary: "Pago de taller vía PSE",
    },
  });
  const other = await prisma.whatsAppPaymentReceipt.create({
    data: { conversationId: conv.id, status: "pending", method: "Nequi", amountMinor: 50000, currency: "COP", reference: `8${run}000000` },
  });

  try {
    const list = await listReceipts(conv.id);
    const card = list.find((r) => r.id === receipt.id);
    check(
      "1. la tarjeta reconoce el pago de la página por la referencia",
      card?.webPayment?.provider === "Mercado Pago" && card.webPayment.amountMinor === 199475,
      card?.webPayment
    );
    check("3. otra referencia: no se reconoce", list.find((r) => r.id === other.id)?.webPayment === null, list.find((r) => r.id === other.id));

    const result = await decideReceipt({ receiptId: receipt.id, decision: "confirm", staffUserId: null, message: null });
    const after = await prisma.whatsAppPaymentReceipt.findUnique({ where: { id: receipt.id }, select: { status: true, paymentId: true, contactId: true } });
    const linked = await prisma.conversation.findUnique({ where: { id: conv.id }, select: { contactId: true } });
    const named = await prisma.contact.findUnique({ where: { id: contact.id }, select: { firstName: true, lastName: true } });
    check(
      "2. confirmar sin número: chat vinculado a la ficha del pago, comprobante enlazado, sin registrar otra vez",
      result.alreadyRegistered &&
        result.contactId === contact.id &&
        linked?.contactId === contact.id &&
        after?.status === "confirmed" &&
        after.paymentId === payment.id &&
        after.contactId === contact.id,
      { result, after, linked }
    );
    check("   la ficha «Pendiente» toma el nombre del comprobante", named?.firstName === "Gina" && named.lastName === "Catalina Sánchez Delgado", named);
    const card2 = (await listReceipts(conv.id)).find((r) => r.id === receipt.id);
    check("   ya no pide registrar el pago", card2?.needsPayment === false, card2);
  } finally {
    await prisma.whatsAppPaymentReceipt.deleteMany({ where: { conversationId: conv.id } });
    await prisma.contactChannelIdentity.deleteMany({ where: { contactId: contact.id } });
    await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => undefined);
    await prisma.payment.delete({ where: { id: payment.id } });
    await prisma.enrollment.delete({ where: { id: enrollment.id } });
    await prisma.contact.delete({ where: { id: contact.id } });
    await prisma.$disconnect();
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(", ")}` : "\n✅ Todo bien");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
