/**
 * Agenda apretada (Dayana, 19-oct: respiro 0, antelación 0, «que se agenden
 * lo más que se pueda en una hora»). Contra la base de DESARROLLO, con Gemini y
 * con un calendario DE MENTIRA (las horas salen de `findFreeSlots` con citas
 * inventadas; nunca se toca el calendario real de Dayana).
 *
 *   GEMINI_MODEL=gemini-3.5-flash-lite GEMINI_API_KEY= bun scripts/whatsapp-free-call-hour-e2e.ts
 *
 * Mañana hay llamadas a las 10:00, 10:30 y 11:00. Se comprueba:
 * 1. Lo que ofrece son los huecos pegados a esas llamadas (9:45, 10:15, 10:45).
 * 2. Pide «mañana a las 10:30» (ocupada): lo verifica (hora) y ofrece las más cercanas.
 * 3. Pide «mañana a las 4 de la tarde» (libre, no ofrecida): la verifica y la agenda.
 */
export {};

process.env.WHATSAPP_AI_DEBOUNCE_MS = "1500";
process.env.NOTIFICATIONS_DRY_RUN = "true";
// `run.ts` solo mira GEMINI_API_KEY: con `GEMINI_API_KEY=` se usa la de respaldo (la gratis).
if (!process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_API_KEY_2?.trim()) process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY_2;

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig, setWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { saveWhatsAppProvider } = await import("@/lib/meta/whatsapp-provider");
  const { setFreeCallCalendarForTests } = await import("@/lib/crm/whatsapp-agent/free-call");
  const { runWhatsAppAi } = await import("@/lib/crm/whatsapp-agent/run");
  const { findFreeSlots } = await import("@/lib/crm/whatsapp-agent/slots");
  const { getDateKeyInTz, zonedDateTimeToUtc } = await import("@/lib/datetime/zoned-time");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  if (!process.env.GEMINI_API_KEY?.trim() && !process.env.GEMINI_API_KEY_2?.trim()) throw new Error("Hace falta una clave de Gemini.");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const TZ = "America/Bogota";
  const THREAD = "573001112299";
  const tomorrow = getDateKeyInTz(new Date(Date.now() + 86_400_000), TZ);
  const at = (hm: string) => zonedDateTimeToUtc(tomorrow, hm, TZ);
  const busy = [
    ["10:00", "10:15"],
    ["10:30", "10:45"],
    ["11:00", "11:15"],
  ].map(([s, e]) => ({ start: at(s).getTime(), end: at(e).getTime() }));
  // Todos los días de 8:00 a 6:00 p. m., para que no dependa del día en que se corre.
  const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, from: "08:00", to: "18:00" }));
  const booked: Date[] = [];
  setFreeCallCalendarForTests({
    available: async (input) =>
      findFreeSlots({ config: { ...input.config, hours, bufferMin: 0, minNoticeHours: 0 }, durationMin: input.durationMin, busy, timezone: input.timezone, now: input.now ?? new Date(), limit: input.limit }),
    book: async (input) => {
      booked.push(input.start);
      return {
        accountId: "e2e-account",
        eventId: `e2e-hour-${Date.now()}`,
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
    booking: { ...previous.booking, enabled: true, aiSchedules: false, hours, bufferMin: 0, minNoticeHours: 0, horizonDays: 7 },
    context: { ...previous.context, v2: true },
    router: { ...previous.router, enabled: true, modes: { ...previous.router.modes, new_lead: "AUTO", returning_lead: "AUTO", free_call_booked: "AUTO" } },
    salesFlow: { ...previous.salesFlow, enabled: true },
    freeCall: { ...previous.freeCall, autoBook: true, soonFirst: true, compact: true, offer: 3, maxPerDay: 20, preferredWeekdays: [] },
  });

  const cleanup = async () => {
    const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: THREAD }, select: { id: true } });
    const ids = convs.map((c) => c.id);
    await prisma.calendarAppointment.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.whatsAppBooking.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.whatsAppMemory.deleteMany({ where: { phone: THREAD } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  };
  await cleanup();

  const conv = await prisma.conversation.create({
    data: { channel: "WHATSAPP", externalThreadId: THREAD, metaAccountId: "test-phone-id", participantName: "Marta", status: "OPEN", lastMessageAt: new Date() },
  });
  let n = 0;
  type Call = { tool: string; input?: Record<string, unknown>; output?: { options?: { startIso: string }[]; booked?: boolean } };
  const say = async (body: string) => {
    const m = await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "INBOUND", status: "DELIVERED", externalMessageId: `wamid.e2e.hour.${Date.now()}.${n++}`, body, sentAt: new Date() },
    });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: m.sentAt, lastMessageAt: m.sentAt } });
    await runWhatsAppAi({ conversationId: conv.id, triggerMessageId: m.externalMessageId! });
    const run = await prisma.whatsAppAiRun.findFirst({ where: { conversationId: conv.id }, orderBy: { queuedAt: "desc" } });
    const reply = await prisma.conversationMessage.findFirst({
      where: { conversationId: conv.id, direction: "OUTBOUND" },
      orderBy: { sentAt: "desc" },
      select: { body: true },
    });
    const calls = (run?.toolCalls ?? []) as Call[];
    console.log(`     PERSONA: ${body}\n     ASISTENTE: ${reply?.body ?? "(nada)"}  [${run?.status}${run?.reason ? `/${run.reason}` : ""}; ${calls.map((c) => `${c.tool}${c.input && Object.keys(c.input).length ? JSON.stringify(c.input) : ""}`).join(", ") || "sin herramientas"}]`);
    return { run, reply: reply?.body ?? "", calls };
  };
  const hm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const offered = (calls: Call[]) => calls.filter((c) => c.tool === "offer_free_call_slots").flatMap((c) => c.output?.options ?? []);

  try {
    await say("Hola, buenas");
    await say("Te escribo desde Medellín. Ando con mucha ansiedad por el trabajo, ya no sé qué hacer");

    console.log("\n1. Acepta la llamada");
    const t1 = await say("Sí, quiero la llamada gratis. ¿Qué horas tienes mañana?");
    const opts = offered(t1.calls);
    check("ofrece horas del calendario", opts.length > 0, t1.calls.map((c) => c.tool));
    check(
      "son los huecos pegados a las llamadas de mañana",
      opts.length > 0 && opts.every((o) => ["09:45", "10:15", "10:45", "11:15"].includes(hm(o.startIso))),
      opts.map((o) => hm(o.startIso))
    );

    console.log("\n2. Pide una hora ocupada");
    const t2 = await say("¿Y mañana a las 10:30 no se puede?");
    const check2 = t2.calls.find((c) => c.tool === "offer_free_call_slots" && (c.input?.hora || c.input?.horaFromText));
    check("la verifica con la hora", Boolean(check2), t2.calls);
    check("no la agenda", booked.length === 0, booked);
    const near = offered(t2.calls).map((o) => hm(o.startIso));
    check("ofrece las más cercanas", near.length > 0 && !near.includes("10:30"), near);

    console.log("\n3. Pide una hora libre que no se le ofreció");
    let t3 = await say("Entonces mañana a las 4 de la tarde, ¿puede ser?");
    check("la verifica con la hora", t3.calls.some((c) => c.tool === "offer_free_call_slots" && (c.input?.hora || c.input?.horaFromText)), t3.calls);
    if (booked.length === 0) t3 = await say("Sí, agéndamela a las 4 por favor");
    check("la agenda", booked.length === 1, t3.calls);
    check("a las 4:00 p. m. de mañana", booked[0]?.toISOString() === at("16:00").toISOString(), booked[0]);
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
  console.log("\n✅ Agenda apretada: todo bien");
};

main();
