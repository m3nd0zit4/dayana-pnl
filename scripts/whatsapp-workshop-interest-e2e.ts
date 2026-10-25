/**
 * Las interesadas en un taller (`workshop-interests.ts`): quién preguntó por
 * él por WhatsApp, para el seguimiento de Dayana. Contra la base de
 * DESARROLLO, con un taller y chats de prueba que se borran al final.
 *
 *   bun --env-file=.env scripts/whatsapp-workshop-interest-e2e.ts
 *
 * 1. Preguntó el costo (y luego el horario): una fila, 2 veces.
 * 2. Preguntó por el botón de la página dos días ANTES de crear el taller: entra.
 * 3. «Son del taller de jabones?»: no entra. Hace 5 días: tampoco (se lee desde 3 días antes de crearlo).
 *    En dos mensajes («para el 15 de noviembre» + «El taller») y sin «taller» («la sanación con el dinero»): entran.
 * 4. Leer otra vez no suma nada (cursor).
 * 5. Marcar el seguimiento; otra edición no puede.
 * 6. «Que la IA le escriba» dentro de las 24 h: el taller y la pregunta del
 *    cupo (el enlace de pago) o la llamada (25-oct), sin horas ni enlace; su
 *    «Quiero separar mi cupo» sigue lo del taller y es elegir el cupo.
 * 7. Otra vez el mismo día: no sale otra vez.
 * 8. Fuera de las 24 h: la plantilla `retomar_conversacion` con esa pregunta.
 *    Sin precio (producto apagado): solo la llamada, como antes.
 * 9. Con el taller sin publicar, no.
 * Envío de mentira: no sale nada a WhatsApp.
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  const { prisma } = await import("@/lib/db");
  const { listWorkshopInterests, setWorkshopInterestStatus, syncWorkshopInterests } = await import("@/lib/crm/workshop-interests");
  const { offerWorkshopCall } = await import("@/lib/crm/workshop-interest-offer");
  const { WORKSHOP_CHOICE, wantsWorkshopSpot, workshopFlowActive, workshopFollowLine } = await import("@/lib/crm/whatsapp-agent/workshop-interest");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
  };

  const run = Date.now().toString().slice(-6);
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600_000);
  // Su producto con precio: el enlace de pago (`/pagar/p/taller-<slug>`).
  const productId = `taller-e2e-taller-${run}`;
  await prisma.product.create({
    data: {
      id: productId,
      kind: "WORKSHOP",
      title: "Tu Sanacion con el Dinero",
      sessionsLabel: "Taller en vivo",
      isActive: true,
      prices: { create: [{ currency: "COP", amountMinor: 190000 }, { currency: "USD", amountMinor: 6000 }] },
    },
  });
  const edition = await prisma.workshopEdition.create({
    data: {
      productId,
      slug: `e2e-taller-${run}`,
      title: "Tu Sanacion con el Dinero",
      status: "DRAFT",
      startsAt: new Date("2026-11-15T17:00:00Z"),
      startsAtHasTime: false,
      timezone: "America/Bogota",
      scheduleLabel: "8:30 a.m. – 4:30 p.m. · virtual",
    },
  });
  const forSync = { ...edition, createdAt: edition.createdAt };
  const ids: string[] = [];
  const chat = async (suffix: string, lines: { body: string; at: Date }[]) => {
    const conv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: `5730088${run}${suffix}`, metaAccountId: "test-phone-id", participantName: `Prueba Taller ${suffix}` },
    });
    ids.push(conv.id);
    for (const l of lines) {
      await prisma.conversationMessage.create({
        data: { conversationId: conv.id, direction: "INBOUND", kind: "message", body: l.body, sentAt: l.at, status: "RECEIVED" },
      });
    }
    return conv.id;
  };

  try {
    const a = await chat("1", [
      { body: "El costo del taller del 15 de noviembre?", at: ago(2) },
      { body: "Perú", at: ago(1.9) },
      { body: "¿y el horario del taller?", at: ago(1) },
    ]);
    const c = await chat("2", [{ body: 'Hola Dayana, me interesa inscribirme al taller "Tu Sanacion con el Dinero".', at: ago(48) }]);
    const b = await chat("3", [{ body: "Son del taller de jabones  ?", at: ago(3) }]);
    const d = await chat("4", [{ body: "¿Cuánto cuesta el taller del 15 de noviembre?", at: ago(24 * 5) }]);
    const e = await chat("5", [
      { body: "Mi pregunta es ,para el 15 de noviembre", at: ago(4) },
      { body: "El taller", at: ago(3.99) },
    ]);
    const f = await chat("6", [{ body: "¿cuánto cuesta la sanación con el dinero?", at: ago(5) }]);
    const g = await chat("7", [
      { body: "Mi pregunta es ,para el 15 de noviembre", at: ago(6) },
      { body: "¿cuánto cuesta?", at: ago(5.99) },
    ]);

    const first = await syncWorkshopInterests(forSync);
    const rows = (await listWorkshopInterests(edition.id)).filter((r) => ids.includes(r.conversationId));
    const rowA = rows.find((r) => r.conversationId === a);
    const rowC = rows.find((r) => r.conversationId === c);
    check("1. preguntó dos veces: una fila, 2 veces, con lo que escribió primero", rowA?.asks === 2 && rowA.firstMessage.startsWith("El costo del taller"), rowA);
    check("2. preguntó antes de crear el taller (botón de la página): entra", Boolean(rowC) && rowC?.status === "nuevo", rowC);
    check("3. otro taller y hace 5 días: no entran", !rows.some((r) => r.conversationId === b || r.conversationId === d), rows);
    check(
      "   la pregunta en dos mensajes y sin la palabra «taller» (el título): entran",
      rows.some((r) => r.conversationId === e) && rows.some((r) => r.conversationId === f) && rows.some((r) => r.conversationId === g),
      rows.map((r) => r.firstMessage)
    );
    check("   nombre y número del chat, sin llamada ni pago", rowA?.name === "Prueba Taller 1" && rowA.phone.endsWith("1") && !rowA.paid && rowA.nextCallAt === null, rowA);

    const again = await syncWorkshopInterests(forSync);
    const rowA2 = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === a);
    check("4. leer otra vez no suma nada", again.changed === 0 && rowA2?.asks === 2, { first, again, rowA2 });

    const ok = await setWorkshopInterestStatus(edition.id, rowA!.id, "contactada");
    const wrong = await setWorkshopInterestStatus("otra-edicion", rowA!.id, "descartada");
    const rowA3 = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === a);
    check("5. marcar «contactada»; otra edición no puede", ok && !wrong && rowA3?.status === "contactada", { ok, wrong, rowA3 });

    // 6–9. «Que la IA le escriba»: envío de mentira (no sale nada a WhatsApp).
    const sent: { conversationId: string; body: string; source?: string | null; template?: unknown }[] = [];
    const fakeSend = async (input: { conversationId: string; body: string; source?: string | null; isAutoReply?: boolean; clientKey?: string | null; template?: unknown }) => {
      sent.push(input);
      const m = await prisma.conversationMessage.create({
        data: {
          conversationId: input.conversationId,
          direction: "OUTBOUND",
          kind: "message",
          body: input.body,
          source: input.source ?? null,
          isAutoReply: input.isAutoReply ?? false,
          clientKey: input.clientKey ?? null,
          status: "SENT",
        },
      });
      return { messageId: m.id, externalMessageId: null, dryRun: true };
    };
    await prisma.workshopEdition.update({ where: { id: edition.id }, data: { status: "OPEN" } });
    // A escribió hace 1 h (dentro de las 24 h); C, hace 2 días.
    await prisma.conversation.update({ where: { id: a }, data: { lastInboundAt: ago(1) } });
    await prisma.conversation.update({ where: { id: c }, data: { lastInboundAt: ago(48) } });

    const offerA = await offerWorkshopCall({ editionId: edition.id, interestId: rowA!.id }, { send: fakeSend });
    const msgA = sent.find((s) => s.conversationId === a);
    const rowA4 = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === a);
    check(
      "6. dentro de las 24 h: el taller, abierto y la pregunta del cupo o la llamada (sin horas ni enlace)",
      offerA.status === "sent" &&
        offerA.via === "text" &&
        Boolean(msgA?.body.includes("Sobre el taller «Tu Sanacion con el Dinero»")) &&
        Boolean(msgA?.body.includes("está abierto")) &&
        Boolean(msgA?.body.endsWith(WORKSHOP_CHOICE)) &&
        !msgA!.body.includes("1. ") &&
        !/https?:/.test(msgA!.body) &&
        msgA?.source === `asistente:taller:${edition.id}` &&
        rowA4?.offeredVia === "text" &&
        rowA4.offeredAt !== null,
      { offerA, msgA, rowA4 }
    );

    // Contesta «Quiero separar mi cupo»: sigue lo del taller y es elegir el cupo (va el enlace).
    await prisma.conversationMessage.create({
      data: { conversationId: a, direction: "INBOUND", kind: "message", body: "Quiero separar mi cupo", sentAt: new Date(), status: "RECEIVED" },
    });
    const thread = await prisma.conversationMessage.findMany({
      where: { conversationId: a },
      orderBy: { sentAt: "desc" },
      take: 10,
      select: { direction: true, body: true, sentAt: true, source: true, isAutoReply: true },
    });
    const ws = { ...edition, cardSummary: null, payUrl: `https://www.dayanabeltran.com/pagar/p/${productId}` };
    const flow = workshopFlowActive([...thread].reverse(), ws, Date.now());
    const spot = wantsWorkshopSpot("Quiero separar mi cupo", { afterChoice: true });
    const line = workshopFollowLine([...thread].reverse(), ws, Date.now());
    check("   «Quiero separar mi cupo»: sigue lo del taller y va el enlace", flow && spot && line.includes("send_workshop_link"), { flow, spot, line });

    const twice = await offerWorkshopCall({ editionId: edition.id, interestId: rowA!.id }, { send: fakeSend });
    check("7. otra vez el mismo día: no sale otra vez", twice.status === "skipped" && twice.reason === "already", twice);

    // Fuera de las 24 h: la plantilla «Retomar la conversación» (en desarrollo no existe: se crea un momento).
    const rowC2 = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === c)!;
    const noTemplate = await offerWorkshopCall({ editionId: edition.id, interestId: rowC2.id }, { send: fakeSend });
    const hadTemplate = await prisma.messageTemplate.findFirst({ where: { key: "retomar_conversacion" }, select: { id: true } });
    const tmp = hadTemplate
      ? null
      : await prisma.messageTemplate.create({
          data: {
            key: "retomar_conversacion",
            title: "Retomar la conversación",
            body: "Hola {{nombre}}, te bendigo 💛 Te escribo para retomar nuestra conversación. {{mensaje}} Quedo atenta a tu respuesta por aquí.",
            metaTemplateName: "retomar_conversacion",
            metaTemplateLang: "es",
            metaApprovalStatus: "APPROVED",
            metaCategory: "MARKETING",
            metaVarNames: ["nombre", "mensaje"],
          },
        });
    try {
      const offerC = await offerWorkshopCall({ editionId: edition.id, interestId: rowC2.id }, { send: fakeSend });
      const msgC = sent.find((s) => s.conversationId === c);
      const tpl = msgC?.template as { name?: string; variables?: string[] } | undefined;
      check(
        "8. fuera de las 24 h: la plantilla, sin nombre que no sea seguro, con la pregunta del cupo o la llamada",
        (hadTemplate || (noTemplate.status === "skipped" && noTemplate.reason === "needs_template")) &&
          offerC.status === "sent" &&
          offerC.via === "template" &&
          tpl?.name === "retomar_conversacion" &&
          tpl.variables?.[0] === "😊" &&
          Boolean(tpl.variables?.[1]?.endsWith(WORKSHOP_CHOICE)) &&
          !msgC!.body.includes("1. "),
        { noTemplate, offerC, msgC }
      );
    } finally {
      if (tmp) await prisma.messageTemplate.delete({ where: { id: tmp.id } });
    }

    // Sin precio (el producto apagado): la página de pago no abre, así que solo la llamada.
    await prisma.product.update({ where: { id: productId }, data: { isActive: false } });
    const rowG = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === g)!;
    await prisma.conversation.update({ where: { id: g }, data: { lastInboundAt: ago(1) } });
    const offerG = await offerWorkshopCall({ editionId: edition.id, interestId: rowG.id }, { send: fakeSend });
    const msgG = sent.find((s) => s.conversationId === g);
    check(
      "   sin precio: solo la llamada para inscribirse",
      offerG.status === "sent" && Boolean(msgG?.body.endsWith("¿Quieres que te la separe?")) && !msgG!.body.includes("cupo"),
      { offerG, msgG }
    );
    await prisma.product.update({ where: { id: productId }, data: { isActive: true } });

    // Un chat asignado a alguien del equipo: la IA no le contestaría, así que no le escribe.
    const staffer = await prisma.staffUser.findFirst({ select: { id: true } });
    const rowE = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === e)!;
    if (staffer) {
      await prisma.conversation.update({ where: { id: e }, data: { lastInboundAt: ago(1), assignedStaffId: staffer.id } });
      const assigned = await offerWorkshopCall({ editionId: edition.id, interestId: rowE.id }, { send: fakeSend });
      check("   asignado a alguien del equipo: no", assigned.status === "skipped" && assigned.reason === "ai_off" && !sent.some((s) => s.conversationId === e), assigned);
      await prisma.conversation.update({ where: { id: e }, data: { assignedStaffId: null } });
    }

    await prisma.workshopEdition.update({ where: { id: edition.id }, data: { status: "DRAFT" } });
    const closed = await offerWorkshopCall({ editionId: edition.id, interestId: rowE.id }, { send: fakeSend });
    check("9. con el taller sin publicar no le escribe", closed.status === "skipped" && closed.reason === "closed", closed);
  } finally {
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.$executeRaw`DELETE FROM workshop_interests WHERE edition_id = ${edition.id}`;
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await prisma.siteSetting.deleteMany({ where: { key: `workshop.interests.cursor.${edition.id}` } });
    await prisma.workshopEdition.delete({ where: { id: edition.id } });
    await prisma.productPrice.deleteMany({ where: { productId } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.$disconnect();
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(", ")}` : "\n✅ Todo bien");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
