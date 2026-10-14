/**
 * Primera vez → llamada gratis agendada sola. Contra la base de DESARROLLO,
 * con Gemini y con un calendario DE MENTIRA (nunca se toca el calendario real
 * de Dayana). Los envíos van en modo prueba.
 *
 *   GEMINI_MODEL=gemini-3.5-flash bun scripts/whatsapp-free-call-e2e.ts
 *
 * Una persona nueva escribe; responde a la asistente; cuenta lo que le pasa;
 * acepta la llamada y elige una hora. Se comprueba:
 * 1. La asistente contesta sola (modo IA) y nunca da precios.
 * 2. Cuando acepta, ofrece horas reales del calendario (offer_free_call_slots).
 * 3. Cuando elige, la cita queda agendada sola (book_free_call), en el CRM
 *    (WhatsAppBooking + cita 0/0 en la agenda) y sin enlace de Meet.
 * 4. Después, su segmento es «llamada gratis agendada».
 */
export {};

process.env.WHATSAPP_AI_DEBOUNCE_MS = "1500";
process.env.NOTIFICATIONS_DRY_RUN = "true";

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig, setWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { saveWhatsAppProvider } = await import("@/lib/meta/whatsapp-provider");
  const { setFreeCallCalendarForTests } = await import("@/lib/crm/whatsapp-agent/free-call");
  const { runWhatsAppAi } = await import("@/lib/crm/whatsapp-agent/run");
  const { computeSegment } = await import("@/lib/crm/whatsapp-agent/segment-store");
  const { mentionsPrice } = await import("@/lib/crm/whatsapp-agent/price-guard");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("Hace falta GEMINI_API_KEY.");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const THREAD = "5218112349903";
  // Calendario de mentira: cuatro horas libres en los próximos días (Bogotá).
  const day = (d: number, hour: number) => {
    const base = new Date();
    base.setUTCDate(base.getUTCDate() + d);
    base.setUTCHours(hour + 5, 0, 0, 0); // hora de Bogotá = UTC-5
    return base;
  };
  const fakeSlots = [day(1, 10), day(1, 15), day(2, 11), day(3, 16)].map((d) => ({
    startIso: d.toISOString(),
    endIso: new Date(d.getTime() + 15 * 60_000).toISOString(),
    dateKey: d.toISOString().slice(0, 10),
    time: "10:00",
  }));
  const booked: { start: Date; addMeet: boolean }[] = [];
  setFreeCallCalendarForTests({
    available: async () => fakeSlots,
    book: async (input) => {
      booked.push({ start: input.start, addMeet: input.config.addMeet });
      return {
        accountId: "e2e-account",
        eventId: `e2e-free-${Date.now()}`,
        meetUrl: null,
        eventUrl: null,
        title: `0/0 Prueba +${THREAD}`,
        end: new Date(input.start.getTime() + input.durationMin * 60_000),
      };
    },
  });

  const previous = await getWhatsAppAiConfig();
  const previousProvider = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
  const previousEnabled = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.autoreply.enabled" } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  await setWhatsAppAiConfig({
    ...previous,
    defaultMode: "AUTO",
    identity: "assistant",
    schedule: { ...previous.schedule, mode: "always" },
    handoffHours: 12,
    booking: { ...previous.booking, enabled: true, aiSchedules: false },
    context: { ...previous.context, v2: true },
    router: { ...previous.router, enabled: true, modes: { ...previous.router.modes, new_lead: "AUTO", returning_lead: "AUTO", free_call_booked: "AUTO" } },
    salesFlow: { ...previous.salesFlow, enabled: true },
    freeCall: { ...previous.freeCall, autoBook: true },
  });

  const cleanup = async () => {
    const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: THREAD }, select: { id: true } });
    const ids = convs.map((c) => c.id);
    await prisma.calendarAppointment.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.whatsAppBooking.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.whatsAppMemory.deleteMany({ where: { phone: THREAD } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  };
  await cleanup();

  const conv = await prisma.conversation.create({
    data: { channel: "WHATSAPP", externalThreadId: THREAD, metaAccountId: "test-phone-id", participantName: "Lucía", status: "OPEN", lastMessageAt: new Date() },
  });
  let n = 0;
  const say = async (body: string) => {
    const m = await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "INBOUND", status: "DELIVERED", externalMessageId: `wamid.e2e.free.${Date.now()}.${n++}`, body, sentAt: new Date() },
    });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: m.sentAt, lastMessageAt: m.sentAt } });
    await runWhatsAppAi({ conversationId: conv.id, triggerMessageId: m.externalMessageId! });
    const run = await prisma.whatsAppAiRun.findFirst({ where: { conversationId: conv.id }, orderBy: { queuedAt: "desc" } });
    const reply = await prisma.conversationMessage.findFirst({
      where: { conversationId: conv.id, direction: "OUTBOUND" },
      orderBy: { sentAt: "desc" },
      select: { body: true },
    });
    const tools = ((run?.toolCalls ?? []) as { tool: string; output?: unknown }[]).map((t) => t.tool);
    console.log(`     PERSONA: ${body}\n     ASISTENTE: ${reply?.body ?? "(nada)"}  [${run?.status}${run?.reason ? `/${run.reason}` : ""}; ${tools.join(", ") || "sin herramientas"}]`);
    return { run, reply: reply?.body ?? "", tools };
  };

  try {
    console.log("\n1. Primera vez");
    const t1 = await say("Hola, buenas tardes");
    check("contesta sola", t1.run?.status === "REPLIED", t1.run?.status);
    check("sin precios", !mentionsPrice(t1.reply));

    const t2 = await say("Bien, gracias. Te escribo desde Monterrey, México. La verdad tengo mucha ansiedad, casi no duermo");
    check("contesta sola", t2.run?.status === "REPLIED", t2.run?.status);

    console.log("\n2. Acepta la llamada");
    const t3 = await say("Sí, me gustaría la llamada gratis. ¿Qué horarios tienes?");
    check("ofrece horas reales del calendario", t3.tools.includes("offer_free_call_slots"), t3.tools);
    check("sin precios", !mentionsPrice(t3.reply));

    console.log("\n3. Elige una hora");
    const t4 = await say("La primera opción me queda perfecta");
    check("agenda sola", t4.tools.includes("book_free_call"), t4.tools);
    const booking = await prisma.whatsAppBooking.findFirst({ where: { conversationId: conv.id } });
    check("la cita queda en el CRM", Boolean(booking), booking);
    check("es la primera hora ofrecida", booking?.startsAt.toISOString() === fakeSlots[0].startIso, booking?.startsAt);
    check("sin enlace de Meet (Dayana llama por WhatsApp)", booked.length === 1 && booked[0].addMeet === false && !booking?.meetUrl, booked);
    const appt = await prisma.calendarAppointment.findFirst({ where: { conversationId: conv.id } });
    check("en la agenda como llamada gratis (0/0)", appt?.sessionsLabel === "0/0", appt);

    console.log("\n4. Segmento");
    const seg = await computeSegment(conv.id);
    check("llamada gratis agendada", seg?.segment === "free_call_booked", seg);

    // Lo que pasó con Rosa (2026-10-14): después de agendar dijo «sí, a esa
    // hora» y la IA pidió agendar otra vez → «Autoriza la cita» de nuevo.
    console.log("\n5. Confirma otra vez la misma hora");
    const t5 = await say("Ahh sí sí, perfecto, a esa hora entonces");
    check("no queda nada por autorizar", t5.run?.status !== "AWAITING_APPROVAL", t5.run?.status);
    check("una sola cita", (await prisma.whatsAppBooking.count({ where: { conversationId: conv.id } })) === 1);
    check("una sola en el calendario", booked.length === 1, booked.length);
  } finally {
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
  console.log("\n✅ Llamada gratis: todo bien");
};

main();
