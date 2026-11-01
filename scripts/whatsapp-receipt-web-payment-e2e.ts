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
 * 5. Pago en la ficha temporal y chat con ficha real (Allison): la inscripción pasa a la real.
 * 6. Dayana dice «recibido» desde el celular a una captura sin monto de quien
 *    acaba de pagar por el enlace: queda enlazada sola, sin registro manual
 *    (dueña, 1-nov). Un Nequi con su propia referencia sigue pidiendo registro,
 *    y la IA nunca confirma un comprobante que no es del enlace.
 * 7. El pago web quedó en la ficha del checkout y el chat en otra con el mismo
 *    número en otra forma (MX 52/521; Diana Ochoa): se reconoce igual.
 * 8. Pago manual de un taller (Ever, 1-nov): la matrícula queda en su edición.
 * 9. Un segundo pago manual del mismo taller se frena (`paidWorkshopPaymentFor`);
 *    una terapia no.
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  // Nada sale de verdad: `recordPayment` (paso 8) emite a Inngest fuera de producción.
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.INNGEST_SIGNING_KEY;
  process.env.INNGEST_DEV = "http://127.0.0.1:9";
  const { prisma } = await import("@/lib/db");
  const { listReceipts } = await import("@/lib/crm/whatsapp-agent/payment-info");
  const { decideReceipt } = await import("@/lib/crm/whatsapp-agent/receipts");
  const { paidWorkshopPaymentFor, recordPayment } = await import("@/lib/crm/payments");

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

    // 5. Allison (25-oct): pagó por PSE con otro correo (ficha temporal «Pendiente») y ya existía
    //    con su chat como «Ana Milena Loaiza»: al confirmar, la inscripción pasa a su ficha real.
    const ana = await prisma.contact.create({ data: { phoneE164: `+57320${run}1`, firstName: "Ana Milena", lastName: "Loaiza", email: `e2e-ana-${run}@example.com` } });
    extra.contacts.push(ana.id);
    const temp = await prisma.contact.create({ data: { phoneE164: `+pending:e2e-ana-${run}`, firstName: "Pendiente", email: `e2e-allison-${run}@example.com` } });
    extra.contacts.push(temp.id);
    const anaEnr = await prisma.enrollment.create({ data: { contactId: temp.id, productId: product.id, status: "ACTIVE" } });
    extra.enrollments.push(anaEnr.id);
    const anaRef = `7${run}471745`;
    const anaPay = await prisma.payment.create({
      data: { enrollmentId: anaEnr.id, provider: "MERCADO_PAGO", providerPaymentId: anaRef, status: "APPROVED", currency: "COP", amountMinor: 199475 },
    });
    extra.payments.push(anaPay.id);
    const anaConv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: `57320${run}1`, metaAccountId: "test-phone-id", participantName: "Aqua Life Spa", contactId: ana.id },
    });
    extra.conversations.push(anaConv.id);
    const anaReceipt = await prisma.whatsAppPaymentReceipt.create({ data: { conversationId: anaConv.id, status: "pending", reference: anaRef } });
    const anaResult = await decideReceipt({ receiptId: anaReceipt.id, decision: "confirm", staffUserId: null, message: null });
    const enrAfter = await prisma.enrollment.findUnique({ where: { id: anaEnr.id }, select: { contactId: true } });
    const tempLeft = await prisma.contact.findUnique({ where: { id: temp.id }, select: { id: true } });
    check(
      "5. pago en la ficha temporal, chat con ficha real: la inscripción pasa a la real y la temporal se borra",
      anaResult.alreadyRegistered && anaResult.contactId === ana.id && enrAfter?.contactId === ana.id && tempLeft === null,
      { anaResult, enrAfter, tempLeft }
    );

    // 6. «Recibido» desde el celular a una captura sin monto, 5 min después de pagar por el enlace.
    const fer = await prisma.contact.create({ data: { phoneE164: `+57301${run}3`, firstName: "Fernanda", email: `e2e-fer-${run}@example.com` } });
    extra.contacts.push(fer.id);
    const ferEnr = await prisma.enrollment.create({ data: { contactId: fer.id, productId: product.id, status: "ACTIVE" } });
    extra.enrollments.push(ferEnr.id);
    const ferPay = await prisma.payment.create({
      data: {
        enrollmentId: ferEnr.id,
        provider: "PAYPAL",
        providerPaymentId: `E2E${run}FER`,
        status: "APPROVED",
        currency: "USD",
        amountMinor: 6374,
        createdAt: new Date(Date.now() - 5 * 60_000),
      },
    });
    extra.payments.push(ferPay.id);
    const ferConv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: `57301${run}3`, metaAccountId: "test-phone-id", participantName: "Fernanda", contactId: fer.id },
    });
    extra.conversations.push(ferConv.id);
    const nequi = await prisma.whatsAppPaymentReceipt.create({
      data: { conversationId: ferConv.id, status: "pending", method: "Nequi", reference: "890811", amountMinor: 190000, currency: "COP" },
    });
    const nequiResult = await decideReceipt({ receiptId: nequi.id, decision: "confirm", staffUserId: null, message: null, via: "chat" });
    check("6. «recibido» a un Nequi con su propia referencia: sigue pidiendo registrarlo", !nequiResult.alreadyRegistered, nequiResult);
    const shot = await prisma.whatsAppPaymentReceipt.create({ data: { conversationId: ferConv.id, status: "pending", payerName: "Fernanda" } });
    const shotResult = await decideReceipt({ receiptId: shot.id, decision: "confirm", staffUserId: null, message: null, via: "chat" });
    const shotAfter = await prisma.whatsAppPaymentReceipt.findUnique({ where: { id: shot.id }, select: { paymentId: true } });
    check(
      "   «recibido» a una captura sin monto de quien pagó por el enlace: enlazada sola, sin registro manual",
      shotResult.alreadyRegistered && shotAfter?.paymentId === ferPay.id,
      { shotResult, shotAfter }
    );

    // 6b. La IA (via «auto») con un comprobante que NO es del pago del enlace: sigue por confirmar.
    const otherShot = await prisma.whatsAppPaymentReceipt.create({
      data: { conversationId: ferConv.id, status: "pending", method: "Bancolombia", amountMinor: 190000, currency: "COP" },
    });
    const autoResult = await decideReceipt({ receiptId: otherShot.id, decision: "confirm", staffUserId: null, via: "auto" });
    const otherAfter = await prisma.whatsAppPaymentReceipt.findUnique({ where: { id: otherShot.id }, select: { status: true, paymentId: true } });
    check(
      "   la IA no confirma un comprobante que no es del enlace: sigue por confirmar para Dayana",
      !autoResult.alreadyRegistered && otherAfter?.status === "pending" && otherAfter.paymentId === null,
      { autoResult, otherAfter }
    );

    // 7. Diana Ochoa: el pago en la ficha del checkout (+521…), el chat en otra ficha (+52…).
    const mxWeb = await prisma.contact.create({ data: { phoneE164: `+521551${run}4`, firstName: "Diana", email: `e2e-diana-web-${run}@example.com` } });
    const mxChat = await prisma.contact.create({ data: { phoneE164: `+52551${run}4`, firstName: "Diana Ochoa", email: `e2e-diana-wa-${run}@example.com` } });
    extra.contacts.push(mxWeb.id, mxChat.id);
    const mxEnr = await prisma.enrollment.create({ data: { contactId: mxWeb.id, productId: product.id, status: "ACTIVE" } });
    extra.enrollments.push(mxEnr.id);
    const mxPay = await prisma.payment.create({
      data: {
        enrollmentId: mxEnr.id,
        provider: "PAYPAL",
        providerPaymentId: `E2E${run}MX`,
        status: "APPROVED",
        currency: "USD",
        amountMinor: 37030,
        createdAt: new Date(Date.now() - 30 * 60_000),
      },
    });
    extra.payments.push(mxPay.id);
    const mxConv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: `52551${run}4`, metaAccountId: "test-phone-id", participantName: "Diana Ochoa", contactId: mxChat.id },
    });
    extra.conversations.push(mxConv.id);
    const mxReceipt = await prisma.whatsAppPaymentReceipt.create({
      data: { conversationId: mxConv.id, status: "pending", amountMinor: 37000, currency: "USD", summary: "Pago de 370 USD por enlace" },
    });
    const mxCard = (await listReceipts(mxConv.id)).find((r) => r.id === mxReceipt.id);
    check("7. el pago web en otra ficha con el mismo número (MX 52/521): se reconoce", mxCard?.webPayment?.paymentId === mxPay.id, mxCard?.webPayment);

    // 8. Ever (1-nov): Nequi del taller registrado a mano → inscrito en la edición.
    const editions = await prisma.workshopEdition.findMany({ where: { productId: product.id }, select: { id: true }, take: 2 });
    if (editions.length !== 1) throw new Error(`El producto ${product.id} no es de UNA edición en desarrollo.`);
    const ever = await prisma.contact.create({ data: { phoneE164: `+57310${run}7`, firstName: "Ever", email: `e2e-ever-${run}@example.com` } });
    extra.contacts.push(ever.id);
    const everEnr = await prisma.enrollment.create({ data: { contactId: ever.id, productId: product.id, status: "PENDING_PAYMENT" } });
    extra.enrollments.push(everEnr.id);
    check("9. antes de pagar, nada frena el registro", (await paidWorkshopPaymentFor(everEnr.id)) === null);
    await recordPayment({
      enrollmentId: everEnr.id,
      provider: "MANUAL",
      providerPaymentId: `manual-e2e-${run}`,
      providerOrderId: "Nequi · Ref. 890811",
      status: "APPROVED",
      currency: "COP",
      amountMinor: 190000,
      paidAt: new Date(),
    });
    const everAfter = await prisma.enrollment.findUnique({ where: { id: everEnr.id }, select: { status: true, workshopEditionId: true } });
    check("8. pago manual de un taller: activo y en su edición", everAfter?.status === "ACTIVE" && everAfter.workshopEditionId === editions[0].id, everAfter);

    // 9. «Otro paquete → el taller» otra vez: matrícula nueva, mismo taller ya pagado.
    const again = await prisma.enrollment.create({ data: { contactId: ever.id, productId: product.id, status: "PENDING_PAYMENT" } });
    extra.enrollments.push(again.id);
    const blocked = await paidWorkshopPaymentFor(again.id);
    check("9. un segundo pago manual del mismo taller se frena", blocked?.provider === "MANUAL" && blocked.amountMinor === 190000, blocked);
    const therapy = await prisma.product.findFirst({ where: { kind: "THERAPY" }, select: { id: true } });
    if (therapy) {
      const th = await prisma.enrollment.create({ data: { contactId: ever.id, productId: therapy.id, status: "PENDING_PAYMENT" } });
      extra.enrollments.push(th.id);
      check("   una terapia no se frena", (await paidWorkshopPaymentFor(th.id)) === null);
    }
  } finally {
    for (const id of extra.conversations) await prisma.whatsAppPaymentReceipt.deleteMany({ where: { conversationId: id } });
    for (const id of extra.conversations) await prisma.conversation.delete({ where: { id } }).catch(() => undefined);
    for (const id of extra.payments) await prisma.payment.delete({ where: { id } }).catch(() => undefined);
    for (const id of extra.enrollments) await prisma.enrollment.delete({ where: { id } }).catch(() => undefined);
    for (const id of extra.contacts) {
      await prisma.contactChannelIdentity.deleteMany({ where: { contactId: id } });
      await prisma.contact.deleteMany({ where: { id } });
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
