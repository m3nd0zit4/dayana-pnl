/**
 * Xime (producción, 22-oct): 20 min antes de su llamada gratis pidió reagendar;
 * la asistente, sin la agenda, le propuso «Mañana viernes a las 8:00 a. m. de tu
 * hora (9:00 a. m. de Colombia), ¿te queda bien?» (esa hora ya era de otra
 * persona); Dayana le mandó un audio («quedamos atentos para reagendar»); a la
 * hora de la llamada Xime dijo «si mañana esta perfecto a esa hora» y la sala de
 * espera lo calló (`free_call_now`); tres minutos después «No contestó» le mandó
 * otras tres horas. Nadie la agendó y ella creyó que tenía llamada el viernes.
 *
 * Contra la base de DESARROLLO, con calendarios DE MENTIRA (nunca el de Dayana)
 * y envíos en modo prueba. El turno de agenda lo hace el código, sin el modelo.
 *
 *   bun --env-file=/e/Dev/Dayana/dayana-pnl/.env scripts/whatsapp-reagenda-xime-e2e.ts
 *
 * (Con un cliente de Prisma viejo —el de node_modules compartido sin
 * `cached_tokens`— la vuelta de la IA falla al guardar: hace falta el generado
 * desde `prisma/schema.prisma`.)
 *
 * 1. La hora que aceptó ya no está libre: a la hora de su llamada, su «sí» se
 *    contesta ya («Perdona, … ya no está libre» + las más cercanas, ofrecidas);
 *    la llamada queda «no contestó» con horas enviadas, y el «No contestó» de
 *    Dayana no manda otras; «la 1» se agenda.
 *    1b. Igual si su «sí» llega pasada la hora de fin de la llamada (sin
 *    resultado, el estado diría «tuvo la llamada»).
 * 2. La hora que aceptó está libre: se agenda esa hora; «No contestó» no manda
 *    horas (ya tiene otra llamada) y la barra del chat no sale.
 * 3. Dayana toca «No contestó» antes de que la IA conteste: el mensaje de
 *    reagendar respeta lo acordado (agenda esa hora o, si no está, le dice que
 *    no y le manda las más cercanas), nunca otras horas sueltas.
 * 4. La sala de espera sigue igual para lo de la llamada de ahora («ya estoy
 *    lista»: la IA no conversa) y otra cosa queda para después de su hora
 *    (`free_call_later`, que «pendientes» retoma).
 */
export {};

process.env.WHATSAPP_AI_DEBOUNCE_MS = "300";
process.env.WHATSAPP_AI_HUMAN_LIVE_WAIT_MS = "200";
process.env.NOTIFICATIONS_DRY_RUN = "true";
// Los avisos quedan en la base de desarrollo: sin clave, Inngest no recibe nada.
delete process.env.INNGEST_EVENT_KEY;
delete process.env.INNGEST_SIGNING_KEY;

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig, setWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { saveWhatsAppProvider } = await import("@/lib/meta/whatsapp-provider");
  const { resolveDryRun } = await import("@/lib/notifications/platform/resolve");
  const { setFreeCallCalendarForTests, latestFreeCallOffer, freeCallService, dualZoneLabel } = await import("@/lib/crm/whatsapp-agent/free-call");
  const { setWaitingCalendarForTests } = await import("@/lib/crm/whatsapp-agent/waiting-room");
  const { markCallOutcome, findCallToMark } = await import("@/lib/crm/whatsapp-agent/call-outcome");
  const { findUnansweredChats } = await import("@/lib/crm/whatsapp-agent/catch-up");
  const { runWhatsAppAi } = await import("@/lib/crm/whatsapp-agent/run");
  const { zonedDateTimeToUtc, getDateKeyInTz } = await import("@/lib/datetime/zoned-time");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  if (!(await resolveDryRun())) throw new Error("WhatsApp no está en modo prueba (NOTIFICATIONS_DRY_RUN): no sigo.");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const MEX = "America/Mexico_City";
  const BOG = "America/Bogota";
  const run = Date.now();
  const now = new Date();
  const dayIn = (days: number, hhmm: string, tz = MEX) => zonedDateTimeToUtc(getDateKeyInTz(new Date(now.getTime() + days * 86_400_000), tz), hhmm, tz);
  const weekday = (d: Date) => new Intl.DateTimeFormat("es-CO", { timeZone: MEX, weekday: "long" }).format(d);
  const dayMonth = (d: Date) => new Intl.DateTimeFormat("es-CO", { timeZone: MEX, day: "numeric", month: "long" }).format(d);
  const label = (d: Date) => dualZoneLabel(d.toISOString(), MEX, BOG);

  // Mañana (en México) a las 8:00: la que aceptó Xime. Alrededor, las libres.
  const tomorrow8 = dayIn(1, "08:00");
  const near = [dayIn(1, "08:45"), dayIn(1, "09:15"), dayIn(1, "10:30"), dayIn(2, "08:15")];
  // Las que se agendan van lejos (≈ 45 días): ni la sincronización ni otras pruebas las tocan.
  const far = { b: dayIn(45, "08:00"), c1: dayIn(46, "11:00"), c2: dayIn(47, "08:00") };
  const farNear = [dayIn(47, "08:30"), dayIn(47, "09:30"), dayIn(47, "12:00")];
  let free = new Set<string>();
  const slot = (d: Date) => ({ startIso: d.toISOString(), endIso: new Date(d.getTime() + 15 * 60_000).toISOString(), dateKey: getDateKeyInTz(d, BOG), time: "" });
  setFreeCallCalendarForTests({
    available: async () => [...free].sort().map((iso) => slot(new Date(iso))),
    book: async (input) => ({
      accountId: "e2e-account",
      eventId: `e2e-xime-${run}-${input.start.getTime()}`,
      meetUrl: null,
      eventUrl: null,
      title: "0/0 Xime Prueba",
      end: new Date(input.start.getTime() + input.durationMin * 60_000),
    }),
    move: async (input) => ({ end: new Date(input.start.getTime() + input.durationMin * 60_000) }),
  });
  // Dayana no está en otra reunión (sin aviso de «está terminando una reunión»).
  setWaitingCalendarForTests(async () => []);

  const previous = await getWhatsAppAiConfig();
  const previousProvider = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
  const previousEnabled = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.autoreply.enabled" } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({ where: { key: "whatsapp.autoreply.enabled" }, create: { key: "whatsapp.autoreply.enabled", value: "true" }, update: { value: "true" } });
  const config = {
    ...previous,
    defaultMode: "AUTO" as const,
    schedule: { ...previous.schedule, mode: "always" as const },
    booking: { ...previous.booking, enabled: true },
    dossier: { ...previous.dossier, enabled: false },
    router: { ...previous.router, enabled: true, modes: { ...previous.router.modes, new_lead: "AUTO" as const, returning_lead: "AUTO" as const, free_call_booked: "AUTO" as const } },
    salesFlow: { ...previous.salesFlow, enabled: true },
    freeCall: { ...previous.freeCall, autoBook: true, controller: true, maxPerDay: 20 },
    waitingRoom: { enabled: true, proactive: false },
    callFollowUp: { enabled: true, askAfterMin: 10, assumeMissedAfterHours: 24 },
  };
  await setWhatsAppAiConfig(config);
  const service = freeCallService(config);

  const conversations: string[] = [];
  let n = 0;
  /** Una Xime con su llamada gratis empezada hace `startedMinAgo` min (3) y el chat de ese día; `ask`: lo que le propuso la asistente. */
  const setup = async (ask: string, startedMinAgo = 3) => {
    const phone = `52177700${String(run).slice(-4)}${n++}`;
    const conv = await prisma.conversation.create({
      data: {
        channel: "WHATSAPP",
        externalThreadId: phone,
        metaAccountId: "test-phone-id",
        participantName: "Xime Prueba",
        status: "OPEN",
        category: "interesada",
        categorySource: "ai",
        categoryConfidence: 0.95,
        lastInboundAt: new Date(now.getTime() - 25 * 60_000),
        lastMessageAt: new Date(now.getTime() - 60_000),
        lastHumanReplyAt: new Date(now.getTime() - 70_000),
      },
    });
    conversations.push(conv.id);
    await prisma.whatsAppDossier.create({ data: { conversationId: conv.id, timezone: MEX, countryIso: "MX" } });
    const start = new Date(now.getTime() - startedMinAgo * 60_000);
    const eventId = `e2e-xime-${run}-call-${n}`;
    await prisma.whatsAppBooking.create({
      data: {
        conversationId: conv.id,
        phone,
        name: "Xime Prueba",
        service: service.name,
        startsAt: start,
        endsAt: new Date(start.getTime() + service.minutes * 60_000),
        googleAccountId: "e2e-account",
        calendarEventId: eventId,
        status: "BOOKED",
        createdAt: new Date(now.getTime() - 3 * 86_400_000),
      },
    });
    const appt = await prisma.calendarAppointment.create({
      data: {
        eventId,
        googleAccountId: "e2e-account",
        startsAt: start,
        endsAt: new Date(start.getTime() + service.minutes * 60_000),
        title: `0/0 Xime Prueba +${phone}`,
        name: "Xime Prueba",
        phone,
        sessionsLabel: "0/0",
        conversationId: conv.id,
        source: "ai",
        status: "active",
        matchState: "phone",
        createdAt: new Date(now.getTime() - 3 * 86_400_000),
      },
    });
    const msg = (direction: "INBOUND" | "OUTBOUND", body: string | null, minutesAgo: number, extra: { isAutoReply?: boolean; isEcho?: boolean; source?: string } = {}) =>
      prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          direction,
          body,
          sentAt: new Date(now.getTime() - minutesAgo * 60_000),
          status: direction === "INBOUND" ? "RECEIVED" : "DELIVERED",
          externalMessageId: `wamid.e2e.xime.${run}.${n}.${minutesAgo}.${direction}`,
          isAutoReply: extra.isAutoReply ?? false,
          isEcho: extra.isEcho ?? false,
          source: extra.source ?? null,
        },
      });
    await msg("OUTBOUND", "Hola 😊, te recuerdo que hoy Dayana te llamará por WhatsApp a este número para tu llamada.", 50, { isAutoReply: true, source: `recordatorio:1h:${eventId}` });
    await msg(
      "INBOUND",
      "Hola hola oye fíjate qué pasó algo imprevisto y el tema es que no voy a estar en un lugar tranquilo ni quería ver si podíamos reagendar porque tiene súper mega interesa igual mañana no sé o qué día tenga libre",
      25
    );
    await msg("OUTBOUND", ask, 24.8, { isAutoReply: true });
    await msg(
      "OUTBOUND",
      "🎤 Hola, mi hermosa, te bendigo, te habla Dayana Beltrán, okay, mi bella, no hay problema, quedamos atentos para reagendar, hacemos esta llamadita en lo que te pueda servir, ¿okay? Bendiciones.",
      1.2,
      { isEcho: true }
    );
    return { conv, appt };
  };
  const write = async (conversationId: string, body: string, opts: { run?: boolean } = {}) => {
    const m = await prisma.conversationMessage.create({
      data: { conversationId, direction: "INBOUND", status: "RECEIVED", externalMessageId: `wamid.e2e.xime.${run}.${n++}`, body, sentAt: new Date() },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: m.sentAt, lastMessageAt: m.sentAt } });
    if (opts.run !== false) await runWhatsAppAi({ conversationId, triggerMessageId: m.externalMessageId! });
    const lastRun = await prisma.whatsAppAiRun.findFirst({ where: { conversationId }, orderBy: { queuedAt: "desc" } });
    return { run: lastRun, out: await outbound(conversationId, m.sentAt) };
  };
  const outbound = async (conversationId: string, since: Date) =>
    (
      await prisma.conversationMessage.findMany({
        where: { conversationId, direction: "OUTBOUND", sentAt: { gte: since } },
        orderBy: { sentAt: "asc" },
        select: { body: true },
      })
    ).map((m) => m.body ?? "");
  const bookingsOf = (conversationId: string) =>
    prisma.whatsAppBooking.findMany({ where: { conversationId, status: { notIn: ["CANCELLED", "cancelled"] } }, orderBy: { startsAt: "asc" } });
  const apptOf = (id: string) => prisma.calendarAppointment.findUniqueOrThrow({ where: { id } });
  const XIME_YES = "si mañana esta perfecto a esa hora";
  const OTHER_HOURS = /no lograron comunicarse/;
  const askTomorrow = `Entiendo perfecto, no hay problema. Mañana ${weekday(tomorrow8)} a las 8:00 a. m. de tu hora (9:00 a. m. de Colombia), ¿te queda bien?`;
  const askOn = (d: Date, mx: string, col: string) => `Entiendo perfecto. ¿Te queda bien el ${weekday(d)} ${dayMonth(d)} a las ${mx} de tu hora (${col} de Colombia)?`;

  try {
    console.log("\n1. Xime: aceptó «mañana a las 8:00» y esa hora ya no está libre");
    free = new Set(near.map((d) => d.toISOString()));
    const a = await setup(askTomorrow);
    const a1 = await write(a.conv.id, XIME_YES);
    check("su «sí» a la hora de la llamada no se calla", a1.run?.status === "REPLIED" && a1.run.reason !== "free_call_now", { status: a1.run?.status, reason: a1.run?.reason });
    check("lo contesta el código, sin el modelo", a1.run?.model === "agenda", a1.run?.model);
    check("le dice que esa hora ya no está libre", a1.out.length === 1 && a1.out[0].startsWith(`Perdona, el ${label(tomorrow8)} ya no está libre`), a1.out);
    // Lo que sale va pulido («1. Jueves…»): se compara sin mayúsculas.
    const has = (text: string | undefined, part: string) => (text ?? "").toLowerCase().includes(part.toLowerCase());
    check("con las más cercanas, la primera 8:45 a. m.", has(a1.out[0], `1. ${label(near[0])}`) && !OTHER_HOURS.test(a1.out[0] ?? ""), a1.out);
    const aOffer = await latestFreeCallOffer(a.conv.id);
    check("quedan ofrecidas (en ese orden)", aOffer?.options.map((o) => o.startIso).join() === near.slice(0, 3).map((d) => d.toISOString()).join(), aOffer?.options);
    check("no se agenda nada todavía", (await bookingsOf(a.conv.id)).length === 1);
    const aAppt = await apptOf(a.appt.id);
    check("la llamada queda «no contestó» (chat) con las horas enviadas", aAppt.callOutcome === "no_answer" && aAppt.callOutcomeSource === "chat" && Boolean(aAppt.rescheduleSentAt), aAppt);
    const aMark = await markCallOutcome({ appointmentId: a.appt.id, outcome: "no_answer" });
    check("el «No contestó» de Dayana ya no manda otras horas", !aMark.ok && aMark.error === "already_decided" && (await outbound(a.conv.id, a1.run!.queuedAt)).length === 1, aMark);
    const a2 = await write(a.conv.id, "la 1");
    const aBooked = await bookingsOf(a.conv.id);
    check("«la 1» se agenda: 8:45 a. m. de mañana", aBooked.some((b) => b.startsAt.getTime() === near[0].getTime()) && a2.out.some((o) => o.startsWith("Listo")), { out: a2.out, aBooked });

    console.log("\n1b. Lo mismo pasada la hora de fin de su llamada (sin resultado: no es «ya la tuviste»)");
    free = new Set(near.map((d) => d.toISOString()));
    const g = await setup(askTomorrow, 20);
    const g1 = await write(g.conv.id, XIME_YES);
    check(
      "su «sí» se contesta con las horas más cercanas, no con «paga primero»",
      g1.run?.model === "agenda" && g1.out.length === 1 && g1.out[0].startsWith(`Perdona, el ${label(tomorrow8)} ya no está libre`),
      { model: g1.run?.model, reason: g1.run?.reason, out: g1.out }
    );

    console.log("\n2. Aceptó una hora que sí está libre: se agenda esa");
    free = new Set([far.b, ...near].map((d) => d.toISOString()));
    const b = await setup(askOn(far.b, "8:00 a. m.", "9:00 a. m."));
    const b1 = await write(b.conv.id, "si, perfecto a esa hora");
    const bBooked = await bookingsOf(b.conv.id);
    check("agendada a esa hora, por código", b1.run?.model === "agenda" && bBooked.some((x) => x.startsAt.getTime() === far.b.getTime()), { out: b1.out, bBooked });
    check("la confirmación dice esa hora", b1.out.length === 1 && b1.out[0].startsWith("Listo") && b1.out[0].includes(label(far.b)), b1.out);
    check("la barra «¿Cómo terminó?» ya no sale (tiene otra llamada)", (await findCallToMark(b.conv.id)) === null);
    const bMark = await markCallOutcome({ appointmentId: b.appt.id, outcome: "no_answer" });
    check("«No contestó» no le manda horas: ya quedó", bMark.ok && !bMark.sent && bMark.reason === "handled" && (await outbound(b.conv.id, b1.run!.queuedAt)).length === 1, bMark);

    console.log("\n3. Dayana toca «No contestó» antes de que la IA conteste");
    free = new Set([far.c1, ...farNear].map((d) => d.toISOString()));
    const c1 = await setup(askOn(far.c1, "11:00 a. m.", "12:00 p. m."));
    const c1Yes = await write(c1.conv.id, "Sí, perfecto", { run: false });
    const c1Mark = await markCallOutcome({ appointmentId: c1.appt.id, outcome: "no_answer" });
    const c1Out = await outbound(c1.conv.id, new Date(now.getTime() - 60_000));
    check("libre: queda agendada a la hora acordada", c1Mark.ok && c1Mark.sent && c1Mark.booked === label(far.c1) && (await bookingsOf(c1.conv.id)).some((x) => x.startsAt.getTime() === far.c1.getTime()), { c1Mark });
    check("…y el mensaje lo confirma, sin otras horas", c1Out.filter((o) => o.startsWith("Listo")).length === 1 && !c1Out.some((o) => OTHER_HOURS.test(o)), { c1Out, yes: c1Yes.out });
    const c2 = await setup(askOn(far.c2, "8:00 a. m.", "9:00 a. m."));
    await write(c2.conv.id, "Sí, perfecto", { run: false });
    const c2Mark = await markCallOutcome({ appointmentId: c2.appt.id, outcome: "no_answer" });
    const c2Out = await outbound(c2.conv.id, new Date(now.getTime() - 60_000));
    check("ocupada: le dice que esa ya no está, con las más cercanas", c2Mark.ok && c2Mark.sent && c2Out.length === 1 && c2Out[0].startsWith(`Perdona, el ${label(far.c2)} ya no está libre`), { c2Mark, c2Out });
    check("…que son las de ese día, no otras sueltas", has(c2Out[0], label(farNear[0])) && !OTHER_HOURS.test(c2Out[0] ?? ""), c2Out);
    const c2Offer = await latestFreeCallOffer(c2.conv.id);
    check("…registradas como ofrecidas («1» se agenda)", c2Offer?.options[0]?.startIso === farNear[0].toISOString(), c2Offer?.options);

    console.log("\n4. La sala de espera, para lo de la llamada de ahora");
    const d = await setup(askTomorrow);
    const d1 = await write(d.conv.id, "Hola, ya estoy lista para la llamada");
    check("«ya estoy lista»: la IA no conversa (Dayana ya le escribió)", d1.run?.reason === "free_call_now" && d1.out.length === 0, { reason: d1.run?.reason, out: d1.out });
    const e = await setup("Perfecto, te espero en tu llamada. ¿Tienes alguna pregunta antes?");
    const e1 = await write(e.conv.id, "¿Cuánto cuesta la terapia?");
    check("otra cosa: queda para después de su hora", e1.run?.reason === "free_call_later" && e1.out.length === 0, { reason: e1.run?.reason, out: e1.out });
    const pending = await findUnansweredChats({ minAgeMin: 0, recentRunMin: 0, limit: 500 });
    check("…y «pendientes» la retoma", pending.some((p) => p.conversationId === e.conv.id), pending.length);
  } finally {
    setFreeCallCalendarForTests({});
    setWaitingCalendarForTests(null);
    await prisma.whatsAppBooking.deleteMany({ where: { conversationId: { in: conversations } } });
    const appts = await prisma.calendarAppointment.findMany({ where: { conversationId: { in: conversations } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: "CalendarAppointment", entityId: { in: appts.map((x) => x.id) } } });
    await prisma.calendarAppointment.deleteMany({ where: { conversationId: { in: conversations } } });
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: conversations } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: conversations } } });
    await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: conversations } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversations } } });
    await setWhatsAppAiConfig(previous);
    if (previousProvider) await prisma.siteSetting.update({ where: { key: "whatsapp.provider" }, data: { value: previousProvider.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.provider" } });
    if (previousEnabled) await prisma.siteSetting.update({ where: { key: "whatsapp.autoreply.enabled" }, data: { value: previousEnabled.value } });
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(" · ")}` : "\n✅ Xime: su «sí» se atiende y «No contestó» respeta lo acordado");
  // Los avisos salen sin esperar: un momento antes de cerrar la base.
  await new Promise((r) => setTimeout(r, 1500));
  await prisma.$disconnect();
  if (failures.length) process.exit(1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
