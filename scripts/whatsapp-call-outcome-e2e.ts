/**
 * ¿Se hizo la llamada gratis? Contra la base de DESARROLLO, con un calendario
 * de mentira y sin IA (todo sale de reglas). Envíos en modo prueba.
 *
 *   bun scripts/whatsapp-call-outcome-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Después de la llamada ella escribe «no me llamaron»: no contestó, y se le
 *    manda el mensaje para reagendar con horas libres (que quedan ofrecidas).
 * 2. El chat no dice nada: se le pregunta «¿Pudiste hablar con Dayana?»;
 *    responde «Sí, gracias»: contestó, y no se le manda nada más.
 * 3. Responde «No, se me pasó»: no contestó y se le mandan horas.
 * 4. Se le preguntó hace 25 h y no respondió: se da por no contestada.
 * 5. Una sesión pagada no entra en esto. 6. Si ya tiene otra llamada agendada: «se reagendó».
 */
export {};

process.env.NOTIFICATIONS_DRY_RUN = "true";

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig, setWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { saveWhatsAppProvider } = await import("@/lib/meta/whatsapp-provider");
  const { setFreeCallCalendarForTests, offeredFreeCallSlots } = await import("@/lib/crm/whatsapp-agent/free-call");
  const { sweepCallOutcomes, handleCallFollowUpReply } = await import("@/lib/crm/whatsapp-agent/call-outcome");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const now = new Date();
  const slot = (h: number) => {
    const d = new Date(now.getTime() + h * 3600_000);
    d.setUTCMinutes(0, 0, 0);
    return { startIso: d.toISOString(), endIso: new Date(d.getTime() + 15 * 60_000).toISOString(), dateKey: d.toISOString().slice(0, 10), time: "10:00" };
  };
  const fakeSlots = [slot(26), slot(30), slot(50)];
  setFreeCallCalendarForTests({ available: async () => fakeSlots });

  const T = { NO: "573000003311", ASK_YES: "573000003312", ASK_NO: "573000003313", TIMEOUT: "573000003314", PAID: "573000003315", RESCHED: "573000003316" };
  const THREADS = Object.values(T);

  const previous = await getWhatsAppAiConfig();
  const previousProvider = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
  const previousEnabled = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.autoreply.enabled" } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({ where: { key: "whatsapp.autoreply.enabled" }, create: { key: "whatsapp.autoreply.enabled", value: "true" }, update: { value: "true" } });
  const config = { ...previous, defaultMode: "COPILOT" as const, booking: { ...previous.booking, enabled: true }, callFollowUp: { enabled: true, askAfterMin: 10, assumeMissedAfterHours: 24 } };
  await setWhatsAppAiConfig(config);

  const cleanup = async () => {
    const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } }, select: { id: true } });
    const ids = convs.map((c) => c.id);
    await prisma.calendarAppointment.deleteMany({ where: { OR: [{ conversationId: { in: ids } }, { eventId: { startsWith: "e2e-outcome-" } }] } });
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  };
  await cleanup();

  let n = 0;
  const setup = async (thread: string, opts: { minutesAgo?: number; label?: string; length?: number } = {}) => {
    const conv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: thread, metaAccountId: "test-phone-id", participantName: "Lucía", status: "OPEN", lastMessageAt: now, lastInboundAt: new Date(now.getTime() - 3600_000) },
    });
    // Escribió antes de la llamada (ventana de 24 h abierta).
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "INBOUND", status: "DELIVERED", externalMessageId: `wamid.e2e.outcome.${Date.now()}.${n++}`, body: "Perfecto, ahí estaré", sentAt: new Date(now.getTime() - 3 * 3600_000) },
    });
    const start = new Date(now.getTime() - (opts.minutesAgo ?? 40) * 60_000);
    const appt = await prisma.calendarAppointment.create({
      data: {
        eventId: `e2e-outcome-${thread}`,
        startsAt: start,
        endsAt: new Date(start.getTime() + (opts.length ?? 15) * 60_000),
        title: `${opts.label ?? "0/0"} Lucía +${thread}`,
        name: "Lucía",
        phone: thread,
        sessionsLabel: opts.label ?? "0/0",
        conversationId: conv.id,
        status: "active",
        matchState: "phone",
      },
    });
    return { conv, appt };
  };
  const write = async (conversationId: string, body: string, at = new Date()) => {
    const m = await prisma.conversationMessage.create({
      data: { conversationId, direction: "INBOUND", status: "DELIVERED", externalMessageId: `wamid.e2e.outcome.${Date.now()}.${n++}`, body, sentAt: at },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: at, lastMessageAt: at } });
    return m;
  };
  const outbound = (conversationId: string) =>
    prisma.conversationMessage.findMany({ where: { conversationId, direction: "OUTBOUND" }, orderBy: { sentAt: "asc" }, select: { body: true } });
  const apptOf = (id: string) => prisma.calendarAppointment.findUniqueOrThrow({ where: { id } });

  try {
    console.log("\n1. Escribe «no me llamaron»");
    const a = await setup(T.NO);
    await write(a.conv.id, "Hola, no me llamaron, sigo esperando");
    await sweepCallOutcomes(config, now);
    const a1 = await apptOf(a.appt.id);
    check("no contestó (según el chat)", a1.callOutcome === "no_answer" && a1.callOutcomeSource === "chat", a1);
    const aOut = await outbound(a.conv.id);
    check("se le mandó el mensaje para reagendar con horas", aOut.some((m) => /no logramos comunicarnos/.test(m.body ?? "") && /•/.test(m.body ?? "")), aOut);
    const offered = await offeredFreeCallSlots(a.conv.id);
    check("esas horas quedan ofrecidas (si elige una, se agenda)", offered.includes(new Date(fakeSlots[0].startIso).toISOString()), offered);

    console.log("\n2. El chat no dice nada → se pregunta; responde que sí");
    const b = await setup(T.ASK_YES);
    await sweepCallOutcomes(config, now);
    const b1 = await apptOf(b.appt.id);
    check("se le preguntó", Boolean(b1.outcomeCheckAt) && (await outbound(b.conv.id)).some((m) => /Pudiste hablar con Dayana/.test(m.body ?? "")));
    const yes = await write(b.conv.id, "Sí, gracias!");
    const rYes = await handleCallFollowUpReply({ config, conversationId: b.conv.id, triggerMessageId: yes.externalMessageId! });
    const b2 = await apptOf(b.appt.id);
    check("contestó", b2.callOutcome === "answered" && b2.callOutcomeSource === "asked", b2);
    check("no se le manda nada más (la IA sigue normal)", !rYes.handled && (await outbound(b.conv.id)).length === 1);

    console.log("\n3. Responde que no");
    const c = await setup(T.ASK_NO);
    await sweepCallOutcomes(config, now);
    const no = await write(c.conv.id, "No, se me pasó, perdón");
    const rNo = await handleCallFollowUpReply({ config, conversationId: c.conv.id, triggerMessageId: no.externalMessageId! });
    const c1 = await apptOf(c.appt.id);
    check("no contestó", c1.callOutcome === "no_answer", c1);
    check("se le mandaron horas para reagendar", rNo.handled && Boolean(c1.rescheduleSentAt));

    console.log("\n4. Se le preguntó hace 25 h y no respondió");
    const d = await setup(T.TIMEOUT, { minutesAgo: 26 * 60 });
    await prisma.calendarAppointment.update({ where: { id: d.appt.id }, data: { outcomeCheckAt: new Date(now.getTime() - 25 * 3600_000) } });
    await sweepCallOutcomes(config, now);
    const d1 = await apptOf(d.appt.id);
    check("se da por no contestada", d1.callOutcome === "no_answer" && d1.callOutcomeSource === "timeout", d1);

    console.log("\n5. Sesión pagada");
    const e = await setup(T.PAID, { label: "3/6", length: 60, minutesAgo: 90 });
    await sweepCallOutcomes(config, now);
    const e1 = await apptOf(e.appt.id);
    check("no entra en el seguimiento", e1.callOutcome === "not_free" && (await outbound(e.conv.id)).length === 0, e1);

    console.log("\n6. Ya tiene otra llamada agendada");
    const f = await setup(T.RESCHED);
    await prisma.calendarAppointment.create({
      data: {
        eventId: `e2e-outcome-later-${T.RESCHED}`,
        startsAt: new Date(now.getTime() + 48 * 3600_000),
        endsAt: new Date(now.getTime() + 48 * 3600_000 + 15 * 60_000),
        title: `0/0 Lucía +${T.RESCHED}`,
        name: "Lucía",
        phone: T.RESCHED,
        sessionsLabel: "0/0",
        conversationId: f.conv.id,
        status: "active",
        matchState: "phone",
      },
    });
    await sweepCallOutcomes(config, now);
    const f1 = await apptOf(f.appt.id);
    check("se reagendó, sin mensajes", f1.callOutcome === "rescheduled" && (await outbound(f.conv.id)).length === 0, f1);
  } finally {
    setFreeCallCalendarForTests({});
    await cleanup();
    await setWhatsAppAiConfig(previous);
    if (previousProvider) await prisma.siteSetting.update({ where: { key: "whatsapp.provider" }, data: { value: previousProvider.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.provider" } });
    if (previousEnabled) await prisma.siteSetting.update({ where: { key: "whatsapp.autoreply.enabled" }, data: { value: previousEnabled.value } });
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallos`);
    process.exit(1);
  }
  console.log("\n✅ Seguimiento de llamadas: todo bien");
};

main();
