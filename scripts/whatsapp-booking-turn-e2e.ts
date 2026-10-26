/**
 * La agenda sin el modelo (`booking-turn.ts`): la persona contesta la lista de
 * horas y el código agenda, mueve, pregunta entre varias o vuelve a ofrecer.
 * Contra la base de DESARROLLO, con un calendario DE MENTIRA (nunca el de
 * Dayana), sin modelo y sin enviar nada.
 *
 *   bun scripts/whatsapp-booking-turn-e2e.ts
 *
 * 1. Natalia (21-oct): «Ya hoy a las 12:45 pm» + «Sii está bien» → se agenda
 *    esa, y la confirmación dice la hora de la reserva de verdad.
 * 2. Después de confirmar, «la 2» ya no contesta ninguna lista: el modelo.
 * 3. «el viernes» con dos horas el viernes → pregunta solo entre esas dos.
 * 4. La hora que eligió ya la tomó otra persona → «Esa hora ya no está libre»
 *    con otras horas (sin la tomada), registradas como ofrecidas.
 * 5. Ya tiene llamada y elige otra de una lista nueva → se mueve la misma.
 * 6. Elige la que ya tiene → «ya está agendada», sin otra reserva.
 * 7. Una pregunta («¿la de las 3 es hora Colombia?») → el modelo.
 * 8. Laura (26-oct): «Disculpa mejor viernes… 9:00 a.m.» + «Te agradezco mucho» → se agenda.
 * 9. Lo largo lo ve el modelo; si confirma esa misma hora sin agendarla, la agenda el
 *    código (`claim`); si confirma otra, nada.
 */
export {};

process.env.NOTIFICATIONS_DRY_RUN = "true";

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { bookFreeCall, setFreeCallCalendarForTests, dualZoneLabel } = await import("@/lib/crm/whatsapp-agent/free-call");
  const { bookingTurn } = await import("@/lib/crm/whatsapp-agent/booking-turn");
  const { offerMessage, bookedMessage } = await import("@/lib/crm/whatsapp-agent/slot-choice");
  const { polishReply } = await import("@/lib/crm/whatsapp-agent/wording");
  const { zonedDateTimeToUtc, getDateKeyInTz } = await import("@/lib/datetime/zoned-time");

  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database()::text AS db`;
  if (db !== "neondb_dev") throw new Error(`Solo contra neondb_dev (esta es ${db}).`);

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const TZ = "America/Bogota";
  const run = Date.now();
  // Lejos (≈ 400 días): la sincronización y otros e2e no tocan estas filas.
  const at = (daysAhead: number, hhmm: string) => zonedDateTimeToUtc(getDateKeyInTz(new Date(Date.now() + daysAhead * 86_400_000), TZ), hhmm, TZ);
  const base = 400;
  const slots = {
    a: at(base, "12:15"),
    b: at(base, "12:30"),
    c: at(base, "12:45"),
    friAm: at(base + 1, "09:00"),
    friPm: at(base + 1, "15:00"),
    // Pasos 8 y 9: horas propias (la del paso 5 ya está tomada).
    lauraA: at(base + 5, "08:15"),
    lauraB: at(base + 6, "11:15"),
    lauraC: at(base + 7, "09:00"),
    longA: at(base + 8, "08:15"),
    longC: at(base + 9, "09:00"),
    longD: at(base + 9, "15:00"),
  };
  const free = new Set(Object.values(slots).map((d) => d.toISOString()));
  const slot = (d: Date) => ({ startIso: d.toISOString(), endIso: new Date(d.getTime() + 15 * 60_000).toISOString(), dateKey: getDateKeyInTz(d, TZ), time: "" });
  let eventN = 0;
  const moves: Date[] = [];
  setFreeCallCalendarForTests({
    available: async () => [...free].map((iso) => slot(new Date(iso))),
    book: async (input) => ({
      accountId: "e2e-account",
      eventId: `e2e-turn-${run}-${++eventN}`,
      meetUrl: null,
      eventUrl: null,
      title: "0/0 Prueba Agenda",
      end: new Date(input.start.getTime() + input.durationMin * 60_000),
    }),
    move: async (input) => {
      moves.push(input.start);
      return { end: new Date(input.start.getTime() + input.durationMin * 60_000) };
    },
  });

  const config = await getWhatsAppAiConfig();
  const label = (d: Date) => dualZoneLabel(d.toISOString(), TZ, TZ);
  const conversations: string[] = [];
  const newChat = async (n: number) => {
    const conv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: `5730${String(run).slice(-6)}${n}`, metaAccountId: "test-phone-id", participantName: "Prueba Agenda" },
    });
    conversations.push(conv.id);
    return conv;
  };
  let clock = Date.now() - 30 * 60_000;
  const tick = () => new Date((clock += 5_000));
  /** La oferta como la registra la IA y el mensaje con la lista que recibió. */
  const offer = async (conversationId: string, ds: Date[]) => {
    const options = ds.map((d) => ({ startIso: d.toISOString(), label: label(d) }));
    await prisma.whatsAppAiRun.create({
      data: {
        conversationId,
        status: "REPLIED",
        queuedAt: tick(),
        toolCalls: [{ tool: "offer_free_call_slots", input: {}, output: { ok: true, options } }],
        finishedAt: new Date(),
      },
    });
    // Lo que de verdad sale (pulido: «1. Jueves…»; revisión 21-oct: así nunca cuadraba).
    await say(conversationId, "OUTBOUND", polishReply(offerMessage("Con gusto.", options, true)));
    return options;
  };
  const say = (conversationId: string, direction: "INBOUND" | "OUTBOUND", body: string) =>
    prisma.conversationMessage.create({
      data: {
        conversationId,
        direction,
        body,
        sentAt: tick(),
        status: direction === "INBOUND" ? "RECEIVED" : "DELIVERED",
        isAutoReply: direction === "OUTBOUND",
      },
    });
  const turn = async (conv: { id: string; contactId: string | null; externalThreadId: string }, claim?: string) =>
    bookingTurn({
      claim,
      config,
      conversationId: conv.id,
      contactId: conv.contactId,
      phone: conv.externalThreadId,
      firstName: "Natalia",
      name: "Natalia",
      personTz: TZ,
      dayanaTz: TZ,
      messages: await prisma.conversationMessage.findMany({
        where: { conversationId: conv.id },
        orderBy: { sentAt: "desc" },
        take: 40,
        select: { direction: true, body: true, sentAt: true, status: true, kind: true, attachments: true },
      }),
    });
  const bookingsOf = (conversationId: string) =>
    prisma.whatsAppBooking.findMany({ where: { conversationId, status: { notIn: ["CANCELLED", "cancelled"] } } });

  try {
    console.log("\n1. Natalia: «Ya hoy a las 12:45 pm» + «Sii está bien»");
    const natalia = await newChat(1);
    await offer(natalia.id, [slots.a, slots.b, slots.c]);
    await say(natalia.id, "INBOUND", `Ya el ${new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "numeric", month: "long" }).format(slots.c)} a las 12:45 pm`);
    await say(natalia.id, "INBOUND", "Sii está bien");
    const r1 = await turn(natalia);
    const b1 = await bookingsOf(natalia.id);
    check("agenda sin el modelo", r1?.model === "agenda", r1?.model);
    check("una reserva, a las 12:45", b1.length === 1 && b1[0].startsAt.getTime() === slots.c.getTime(), b1.map((b) => b.startsAt));
    check(
      "la confirmación es la del código, con esa hora",
      r1?.outcome.kind === "reply" && r1.outcome.message === bookedMessage("booked", label(slots.c), "Natalia"),
      r1?.outcome
    );
    check("bookingNotice y booking", r1?.bookingNotice?.kind === "booked" && r1.booking?.startsAt.getTime() === slots.c.getTime());

    console.log("\n2. Después de la confirmación, «la 2» no contesta ninguna lista");
    if (r1?.outcome.kind === "reply") await say(natalia.id, "OUTBOUND", r1.outcome.message);
    await say(natalia.id, "INBOUND", "la 2");
    const r2 = await turn(natalia);
    check("sigue el modelo (null)", r2 === null, r2?.outcome);
    check("sigue una sola reserva", (await bookingsOf(natalia.id)).length === 1);

    console.log("\n3. «el viernes» con dos horas el viernes");
    const many = await newChat(2);
    await offer(many.id, [slots.a, slots.friAm, slots.friPm]);
    await say(many.id, "INBOUND", new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "long" }).format(slots.friAm));
    const r3 = await turn(many);
    const narrowed = (r3?.toolCalls.find((t) => t.tool === "offer_free_call_slots")?.output as { options?: { startIso: string }[] } | undefined)?.options;
    check("pregunta entre esas dos", r3?.outcome.kind === "reply" && r3.outcome.message.startsWith("¿Cuál de estas?"), r3?.outcome);
    check(
      "registra las dos como la lista nueva",
      narrowed?.map((o) => o.startIso).join() === [slots.friAm, slots.friPm].map((d) => d.toISOString()).join(),
      narrowed
    );
    check("no agenda", (await bookingsOf(many.id)).length === 0);

    console.log("\n4. La hora que eligió ya la tomó otra persona");
    const other = await newChat(3);
    await bookFreeCall({ config, dayanaTz: TZ, personTz: TZ, start: slots.a, conversationId: other.id, contactId: null, phone: other.externalThreadId, name: "Otra" });
    const taken = await newChat(4);
    await offer(taken.id, [slots.friAm, slots.a]);
    await say(taken.id, "INBOUND", "la 2");
    const r4 = await turn(taken);
    const reoffered = (r4?.toolCalls.find((t) => t.tool === "offer_free_call_slots")?.output as { options?: { startIso: string }[] } | undefined)?.options ?? [];
    check("«Esa hora ya no está libre» con otras", r4?.outcome.kind === "reply" && r4.outcome.message.startsWith("Esa hora ya no está libre"), r4?.outcome);
    check("sin la tomada", reoffered.length > 0 && !reoffered.some((o) => o.startIso === slots.a.toISOString()), reoffered);
    check("no agenda", (await bookingsOf(taken.id)).length === 0);

    console.log("\n5. Ya tiene llamada y elige otra de una lista nueva: se mueve");
    const mover = await newChat(5);
    await bookFreeCall({ config, dayanaTz: TZ, personTz: TZ, start: slots.friPm, conversationId: mover.id, contactId: null, phone: mover.externalThreadId, name: "Mueve" });
    await offer(mover.id, [slots.friAm, slots.friPm]);
    await say(mover.id, "INBOUND", "a las 9 am");
    const r5 = await turn(mover);
    const b5 = await bookingsOf(mover.id);
    check("movida", r5?.bookingNotice?.kind === "moved", r5?.outcome);
    check("una sola reserva, a la hora nueva", b5.length === 1 && b5[0].startsAt.getTime() === slots.friAm.getTime(), b5.map((b) => b.startsAt));
    check("el evento se movió", moves.some((d) => d.getTime() === slots.friAm.getTime()), moves);

    console.log("\n6. Elige la que ya tiene");
    await say(mover.id, "OUTBOUND", "(otra lista)");
    await offer(mover.id, [slots.friAm, slots.friPm]);
    await say(mover.id, "INBOUND", "1");
    const r6 = await turn(mover);
    check("«ya está agendada»", r6?.outcome.kind === "reply" && r6.outcome.message.startsWith("Tu llamada gratis con Dayana ya está agendada"), r6?.outcome);
    check("sin otra reserva", (await bookingsOf(mover.id)).length === 1);

    console.log("\n7. Una pregunta no es elegir");
    const asks = await newChat(6);
    await offer(asks.id, [slots.a, slots.friPm]);
    await say(asks.id, "INBOUND", "¿la de las 3 es hora Colombia?");
    check("sigue el modelo (null)", (await turn(asks)) === null);

    const dayLabel = (d: Date) => new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d).replace(",", "");
    console.log("\n8. Laura: la cortesía alrededor de la elección");
    const laura = await newChat(7);
    await offer(laura.id, [slots.lauraA, slots.lauraB, slots.lauraC]);
    await say(laura.id, "INBOUND", `Disculpa mejor ${dayLabel(slots.lauraC)}, 9:00 a.m.`);
    await say(laura.id, "INBOUND", "Te agradezco mucho");
    const r8 = await turn(laura);
    const b8 = await bookingsOf(laura.id);
    check("agenda sin el modelo", r8?.model === "agenda" && r8.bookingNotice?.kind === "booked", r8?.outcome);
    check("a las 9:00 a. m. de ese día", b8.length === 1 && b8[0].startsAt.getTime() === slots.lauraC.getTime(), b8.map((b) => b.startsAt));

    console.log("\n9. Lo largo: el modelo; si confirma esa hora sin agendar, el código la agenda");
    const long = await newChat(8);
    await offer(long.id, [slots.longA, slots.longC, slots.longD]);
    await say(long.id, "INBOUND", `Ay qué pena contigo, me equivoqué de día, mejor el ${dayLabel(slots.longC)} a las 9:00 a.m. que salgo temprano`);
    check("sin confirmación del modelo: el modelo (null)", (await turn(long)) === null);
    check("confirma otra hora: nada", (await turn(long, `Listo, tu llamada con Dayana queda para el ${dayLabel(slots.longD)} a las 3:00 p. m.`)) === null);
    const r9 = await turn(long, `Perfecto, tu llamada con Dayana queda para el ${dayLabel(slots.longC)} a las 9:00 a. m.`);
    const b9 = await bookingsOf(long.id);
    check("confirma esa hora: agendada", r9?.bookingNotice?.kind === "booked" && b9.length === 1 && b9[0].startsAt.getTime() === slots.longC.getTime(), {
      outcome: r9?.outcome,
      b9: b9.map((b) => b.startsAt),
    });
  } finally {
    setFreeCallCalendarForTests({});
    await prisma.whatsAppBooking.deleteMany({ where: { conversationId: { in: conversations } } });
    await prisma.calendarAppointment.deleteMany({ where: { conversationId: { in: conversations } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversations } } });
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(" · ")}` : "\n✅ La agenda sin el modelo hace lo correcto");
  await prisma.$disconnect();
  if (failures.length) process.exit(1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
