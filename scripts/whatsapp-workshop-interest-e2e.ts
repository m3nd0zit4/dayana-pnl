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
 * 6. «Ofrecerle la llamada» dentro de las 24 h: el taller y 2 horas numeradas,
 *    guardadas como ofrecidas; su «2» es respuesta a esa lista.
 * 7. Otra vez el mismo día: no sale otra lista.
 * 8. Fuera de las 24 h: la plantilla `retomar_conversacion` (sin horas).
 * 9. Con el taller sin publicar, no.
 * Calendario y envío de mentira: no sale nada a WhatsApp.
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  const { prisma } = await import("@/lib/db");
  const { listWorkshopInterests, setWorkshopInterestStatus, syncWorkshopInterests } = await import("@/lib/crm/workshop-interests");
  const { offerWorkshopCall } = await import("@/lib/crm/workshop-interest-offer");
  const { latestFreeCallOffer, setFreeCallCalendarForTests } = await import("@/lib/crm/whatsapp-agent/free-call");
  const { replyToOffer } = await import("@/lib/crm/whatsapp-agent/slot-choice");
  const { workshopFlowActive } = await import("@/lib/crm/whatsapp-agent/workshop-interest");
  const { getDateKeyInTz, zonedDateTimeToUtc } = await import("@/lib/datetime/zoned-time");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
  };

  const run = Date.now().toString().slice(-6);
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600_000);
  const edition = await prisma.workshopEdition.create({
    data: {
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

    // 6–9. «Ofrecerle la llamada»: calendario y envío de mentira (no sale nada a WhatsApp).
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
    const TZ = "America/Bogota";
    const slotAt = (daysAhead: number, hhmm: string) => zonedDateTimeToUtc(getDateKeyInTz(new Date(now + daysAhead * 86_400_000), TZ), hhmm, TZ);
    const fakeSlot = (d: Date) => ({ startIso: d.toISOString(), endIso: new Date(d.getTime() + 15 * 60_000).toISOString(), dateKey: getDateKeyInTz(d, TZ), time: "" });
    setFreeCallCalendarForTests({ available: async () => [fakeSlot(slotAt(2, "10:00")), fakeSlot(slotAt(3, "15:00"))] });
    await prisma.workshopEdition.update({ where: { id: edition.id }, data: { status: "OPEN" } });
    // A escribió hace 1 h (dentro de las 24 h); C, hace 2 días.
    await prisma.conversation.update({ where: { id: a }, data: { lastInboundAt: ago(1) } });
    await prisma.conversation.update({ where: { id: c }, data: { lastInboundAt: ago(48) } });

    const offerA = await offerWorkshopCall({ editionId: edition.id, interestId: rowA!.id }, { send: fakeSend });
    const msgA = sent.find((s) => s.conversationId === a);
    const offerRun = await latestFreeCallOffer(a);
    const rowA4 = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === a);
    check(
      "6. dentro de las 24 h: el taller, abierto, la llamada y 2 horas numeradas, marcadas como ofrecidas",
      offerA.status === "sent" &&
        offerA.via === "text" &&
        offerA.slots === 2 &&
        Boolean(msgA?.body.includes("Sobre el taller «Tu Sanacion con el Dinero»")) &&
        Boolean(msgA?.body.includes("está abierto")) &&
        Boolean(msgA?.body.includes("llamada con Dayana")) &&
        Boolean(msgA?.body.includes("1. ") && msgA.body.includes("2. ") && msgA.body.includes("¿Cuál te queda mejor?")) &&
        msgA?.source === `asistente:taller:${edition.id}` &&
        offerRun?.options.length === 2 &&
        rowA4?.offeredVia === "text" &&
        rowA4.offeredAt !== null,
      { offerA, msgA, offerRun, rowA4 }
    );

    // Contesta «2»: lo agenda el código (la lista es lo último que recibió) y sigue en lo del taller.
    await prisma.conversationMessage.create({
      data: { conversationId: a, direction: "INBOUND", kind: "message", body: "2", sentAt: new Date(), status: "RECEIVED" },
    });
    const thread = await prisma.conversationMessage.findMany({
      where: { conversationId: a },
      orderBy: { sentAt: "desc" },
      take: 10,
      select: { direction: true, body: true, sentAt: true, kind: true, status: true, attachments: true, source: true, isAutoReply: true },
    });
    const choice = offerRun ? replyToOffer(thread, offerRun) : null;
    const flow = workshopFlowActive([...thread].reverse(), { ...edition, cardSummary: null }, Date.now());
    check("   «2»: es respuesta a esa lista y sigue lo del taller", choice === "2" && flow, { choice, flow });

    const twice = await offerWorkshopCall({ editionId: edition.id, interestId: rowA!.id }, { send: fakeSend });
    check("7. otra vez el mismo día: no sale otra lista", twice.status === "skipped" && twice.reason === "already", twice);

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
        "8. fuera de las 24 h: la plantilla, sin horas, sin nombre que no sea seguro, «¿Quieres que te la separe?»",
        (hadTemplate || (noTemplate.status === "skipped" && noTemplate.reason === "needs_template")) &&
          offerC.status === "sent" &&
          offerC.via === "template" &&
          tpl?.name === "retomar_conversacion" &&
          tpl.variables?.[0] === "😊" &&
          Boolean(tpl.variables?.[1]?.endsWith("¿Quieres que te la separe?")) &&
          !msgC!.body.includes("1. "),
        { noTemplate, offerC, msgC }
      );
    } finally {
      if (tmp) await prisma.messageTemplate.delete({ where: { id: tmp.id } });
    }

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
    setFreeCallCalendarForTests({});
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.$executeRaw`DELETE FROM workshop_interests WHERE edition_id = ${edition.id}`;
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await prisma.siteSetting.deleteMany({ where: { key: `workshop.interests.cursor.${edition.id}` } });
    await prisma.workshopEdition.delete({ where: { id: edition.id } });
    await prisma.$disconnect();
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(", ")}` : "\n✅ Todo bien");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
