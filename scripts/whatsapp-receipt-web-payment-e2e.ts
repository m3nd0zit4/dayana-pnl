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
 * 4. Sin referencia (Victorino): la misma persona pagó por la página hace 5 min;
 *    la tarjeta avisa, «Es otro pago» no enlaza y «Es ese mismo pago» sí.
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
  const extra = { contacts: [] as string[], enrollments: [] as string[], payments: [] as string[], conversations: [] as string[] };
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

    // 4. Victorino (25-oct): pagó por PayPal y 5 min después mandó la captura sin valor ni referencia.
    const vic = await prisma.contact.create({ data: { phoneE164: `+57300${run}9`, firstName: "Victorino", email: `e2e-vic-${run}@example.com` } });
    extra.contacts.push(vic.id);
    const vicEnr = await prisma.enrollment.create({ data: { contactId: vic.id, productId: product.id, status: "ACTIVE" } });
    extra.enrollments.push(vicEnr.id);
    const vicPay = await prisma.payment.create({
      data: {
        enrollmentId: vicEnr.id,
        provider: "PAYPAL",
        providerPaymentId: `E2E${run}VIC`,
        status: "APPROVED",
        currency: "USD",
        amountMinor: 6374,
        createdAt: new Date(Date.now() - 5 * 60_000),
      },
    });
    extra.payments.push(vicPay.id);
    const vicConv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: `57300${run}9`, metaAccountId: "test-phone-id", participantName: "Victorino", contactId: vic.id },
    });
    extra.conversations.push(vicConv.id);
    const r1 = await prisma.whatsAppPaymentReceipt.create({ data: { conversationId: vicConv.id, status: "pending", payerName: "Victorino" } });
    const r2 = await prisma.whatsAppPaymentReceipt.create({ data: { conversationId: vicConv.id, status: "pending", payerName: "Victorino" } });
    const vicCard = (await listReceipts(vicConv.id)).find((r) => r.id === r1.id);
    check(
      "4. sin referencia, la misma persona pagó por la página hace 5 min: la tarjeta avisa (a confirmar)",
      vicCard?.webPayment?.match === "person" && vicCard.webPayment.paymentId === vicPay.id,
      vicCard?.webPayment
    );
    const asOther = await decideReceipt({ receiptId: r1.id, decision: "confirm", staffUserId: null, message: null });
    const r1After = await prisma.whatsAppPaymentReceipt.findUnique({ where: { id: r1.id }, select: { paymentId: true } });
    check("   «Es otro pago»: no se enlaza (Dayana lo registra)", !asOther.alreadyRegistered && r1After?.paymentId === null, { asOther, r1After });
    const r1Card = (await listReceipts(vicConv.id)).find((r) => r.id === r1.id);
    check("   ya confirmado sin pago: la tarjeta corta también avisa del pago de la página", r1Card?.needsPayment === true && r1Card.webPayment?.match === "person", r1Card);
    const same = await decideReceipt({ receiptId: r2.id, decision: "confirm", staffUserId: null, message: null, sameAsWeb: true });
    const r2After = await prisma.whatsAppPaymentReceipt.findUnique({ where: { id: r2.id }, select: { paymentId: true } });
    check("   «Es ese mismo pago»: enlazado al de PayPal, sin registrar otro", same.alreadyRegistered && r2After?.paymentId === vicPay.id, { same, r2After });
  } finally {
    for (const id of extra.conversations) await prisma.whatsAppPaymentReceipt.deleteMany({ where: { conversationId: id } });
    for (const id of extra.conversations) await prisma.conversation.delete({ where: { id } }).catch(() => undefined);
    for (const id of extra.payments) await prisma.payment.delete({ where: { id } }).catch(() => undefined);
    for (const id of extra.enrollments) await prisma.enrollment.delete({ where: { id } }).catch(() => undefined);
    for (const id of extra.contacts) {
      await prisma.contactChannelIdentity.deleteMany({ where: { contactId: id } });
      await prisma.contact.delete({ where: { id } }).catch(() => undefined);
    }
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
