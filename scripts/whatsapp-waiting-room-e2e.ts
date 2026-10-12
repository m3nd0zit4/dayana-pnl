/**
 * Sala de espera de la llamada gratis. Contra la base de DESARROLLO, con un
 * calendario de mentira y sin IA (el aviso es un texto fijo). Envíos en modo prueba.
 *
 *   bun scripts/whatsapp-waiting-room-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Escribe a la hora de su llamada gratis y Dayana sigue en otra reunión:
 *    «Dayana está terminando una reunión…», una vez, y la IA no conversa.
 * 2. Vuelve a escribir enseguida: no se repite el aviso.
 * 3. Una sesión pagada a la misma hora no recibe el aviso.
 * 4. Sin nada en el calendario y ya es la hora: «ya le aviso a Dayana».
 */
export {};

process.env.WHATSAPP_AI_DEBOUNCE_MS = "500";
process.env.NOTIFICATIONS_DRY_RUN = "true";

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig, setWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { saveWhatsAppProvider } = await import("@/lib/meta/whatsapp-provider");
  const { setWaitingCalendarForTests } = await import("@/lib/crm/whatsapp-agent/waiting-room");
  const { runWhatsAppAi } = await import("@/lib/crm/whatsapp-agent/run");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const FREE = "573000004411";
  const PAID = "573000004412";
  const IDLE = "573000004413";
  const THREADS = [FREE, PAID, IDLE];
  const now = new Date();
  const start = new Date(now.getTime() - 2 * 60_000); // su hora fue hace 2 minutos
  let busy: { start: Date; end: Date }[] = [{ start: new Date(now.getTime() - 60 * 60_000), end: new Date(now.getTime() + 8 * 60_000) }];
  setWaitingCalendarForTests(async () => busy);

  const previous = await getWhatsAppAiConfig();
  const previousProvider = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
  const previousEnabled = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.autoreply.enabled" } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  await setWhatsAppAiConfig({ ...previous, defaultMode: "COPILOT", waitingRoom: { enabled: true, proactive: false } });

  const cleanup = async () => {
    const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } }, select: { id: true } });
    const ids = convs.map((c) => c.id);
    await prisma.calendarAppointment.deleteMany({ where: { OR: [{ conversationId: { in: ids } }, { eventId: { startsWith: "e2e-wait-" } }] } });
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  };
  await cleanup();

  const setup = async (thread: string, minutes: number, label: string) => {
    const conv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: thread, metaAccountId: "test-phone-id", participantName: "Lucía", status: "OPEN", lastMessageAt: now, lastInboundAt: now },
    });
    await prisma.calendarAppointment.create({
      data: {
        eventId: `e2e-wait-${thread}`,
        startsAt: start,
        endsAt: new Date(start.getTime() + minutes * 60_000),
        title: `${label} Lucía +${thread}`,
        name: "Lucía",
        phone: thread,
        sessionsLabel: label,
        conversationId: conv.id,
        status: "active",
        matchState: "phone",
      },
    });
    return conv;
  };
  let n = 0;
  const write = async (conversationId: string, body: string) => {
    const m = await prisma.conversationMessage.create({
      data: { conversationId, direction: "INBOUND", status: "DELIVERED", externalMessageId: `wamid.e2e.wait.${Date.now()}.${n++}`, body, sentAt: new Date() },
    });
    await runWhatsAppAi({ conversationId, triggerMessageId: m.externalMessageId! });
    const run = await prisma.whatsAppAiRun.findFirst({ where: { conversationId }, orderBy: { queuedAt: "desc" } });
    const out = await prisma.conversationMessage.findMany({ where: { conversationId, direction: "OUTBOUND" }, orderBy: { sentAt: "asc" }, select: { body: true } });
    return { run, out: out.map((o) => o.body ?? "") };
  };

  try {
    console.log("\n1. Llamada gratis y Dayana en otra reunión");
    const free = await setup(FREE, 15, "0/0");
    const a = await write(free.id, "Hola, ya estoy lista para la llamada");
    check("se le avisa que espere 5 minutos", a.out.length === 1 && /terminando una reuni[oó]n/.test(a.out[0]) && /5 minutos/.test(a.out[0]), a.out);
    check("queda en el rastro como sala de espera", a.run?.reason === "waiting_room:busy", a.run?.reason);

    console.log("\n2. Vuelve a escribir enseguida");
    const b = await write(free.id, "¿Sigues ahí?");
    check("no se repite el aviso", b.out.length === 1, b.out);
    check("la IA no se pone a conversar", b.run?.reason === "free_call_now", b.run?.reason);

    console.log("\n3. Sesión pagada a la misma hora");
    const paid = await setup(PAID, 60, "3/6");
    const c = await write(paid.id, "Hola, ya estoy lista");
    check("no recibe el aviso", !c.out.some((o) => /terminando una reuni[oó]n/.test(o)), c.out);

    console.log("\n4. Nada en el calendario y ya es la hora");
    busy = [];
    const idle = await setup(IDLE, 15, "0/0");
    const d = await write(idle.id, "Hola, ya estoy");
    check("«ya le aviso a Dayana»", d.out.length === 1 && /ya le aviso a Dayana/.test(d.out[0]), d.out);
  } finally {
    setWaitingCalendarForTests(null);
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
  console.log("\n✅ Sala de espera: todo bien");
};

main();
