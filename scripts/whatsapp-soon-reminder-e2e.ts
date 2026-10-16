/**
 * Recordatorio de la llamada gratis una hora antes y el reloj pegado a los
 * avisos. Contra la base de DESARROLLO, sin calendario de Google (las citas se
 * crean a mano) y con WhatsApp en modo prueba: no sale ningún mensaje de verdad.
 *
 *   bun scripts/whatsapp-soon-reminder-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Llamada gratis en 55 min, escribió hace 1 h: sale el recordatorio como
 *    texto, en su hora (la de su ficha), y queda en el chat.
 * 2. Una segunda pasada (y dos a la vez) no lo repiten.
 * 3. Una sesión pagada a la misma hora: nada.
 * 4. Agendada 40 min antes de la hora: no hace falta (se marca y no se manda).
 * 5. Fuera de las 24 h y sin la plantilla aprobada: no sale y queda el motivo.
 * 6. Con Meet, o dentro de 2 h: nada (todavía).
 * 7. El turno del reloj: gana uno solo aunque lleguen dos a la vez, y cada
 *    paso corre cuando le toca (citas cada 15 min, recordatorios y seguimiento
 *    de la llamada gratis cada 5).
 */
export {};

process.env.NOTIFICATIONS_DRY_RUN = "true";
// Los avisos quedan en la base de desarrollo: sin clave, Inngest rechaza el
// evento del correo (si no, saldría a Inngest con la clave del .env).
delete process.env.INNGEST_EVENT_KEY;
delete process.env.INNGEST_SIGNING_KEY;

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig, setWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { saveWhatsAppProvider } = await import("@/lib/meta/whatsapp-provider");
  const { resolveDryRun } = await import("@/lib/notifications/platform/resolve");
  const { sendSoonReminders } = await import("@/lib/crm/whatsapp-agent/appointments");
  const { CLOCK_FOLLOWUP_KEY, CLOCK_PENDING_KEY, CLOCK_REMINDERS_KEY, CLOCK_SYNC_KEY, claimClockSlot, runClockTick } = await import("@/lib/crm/whatsapp-agent/tick");
  const { getTimeLabelInTz } = await import("@/lib/datetime/zoned-time");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  if (!(await resolveDryRun())) throw new Error("WhatsApp no está en modo prueba (NOTIFICATIONS_DRY_RUN): no sigo.");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const T = {
    ROSA: "573000006101",
    PAID: "573000006102",
    LATE: "573000006103",
    NOWIN: "573000006104",
    MEET: "573000006105",
    LATER: "573000006106",
    TWICE: "573000006107",
  };
  const THREADS = Object.values(T);
  const run = Date.now();
  // Las citas van 400 días adelante (con ese «ahora»), para que ninguna otra
  // cita de esta base entre en la ventana. La ventana de 24 h del chat sí se
  // mide con el reloj de verdad.
  const real = new Date();
  const now = new Date(real.getTime() + 400 * 24 * 3600_000);
  const inMin = (m: number) => new Date(now.getTime() + m * 60_000);
  const ago = (m: number) => new Date(real.getTime() - m * 60_000);
  const TEMPLATE_KEY = "cita_recordatorio_hoy";
  const TEST_CLOCK_KEY = `e2e.clock.${run}`;

  const previous = await getWhatsAppAiConfig();
  const previousProvider = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
  const previousReminders = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.cron.reminders_enabled" } });
  const previousClock = await prisma.siteSetting.findMany({ where: { key: { in: [CLOCK_SYNC_KEY, CLOCK_REMINDERS_KEY, CLOCK_FOLLOWUP_KEY, CLOCK_PENDING_KEY] } } });
  // Si la plantilla estuviera aprobada en esta base, se deja pendiente durante la prueba.
  const previousTemplate = await prisma.messageTemplate.findMany({
    where: { key: TEMPLATE_KEY },
    select: { id: true, metaApprovalStatus: true },
  });
  await prisma.messageTemplate.updateMany({ where: { key: TEMPLATE_KEY }, data: { metaApprovalStatus: "PENDING" } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.cron.reminders_enabled" } }); // sin fila = encendidos
  const config = {
    ...previous,
    freeCallReminder: { ...previous.freeCallReminder, enabled: true, minutesBefore: 60 },
    // El seguimiento de la llamada gratis va en su propio turno (aquí, de mentira).
    callFollowUp: { ...previous.callFollowUp, enabled: true },
  };
  await setWhatsAppAiConfig(config);

  const cleanup = async () => {
    const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } }, select: { id: true } });
    const ids = convs.map((c) => c.id);
    await prisma.calendarAppointment.deleteMany({ where: { OR: [{ conversationId: { in: ids } }, { eventId: { startsWith: "e2e-soon-" } }] } });
    await prisma.whatsAppBooking.deleteMany({ where: { OR: [{ conversationId: { in: ids } }, { calendarEventId: { startsWith: "e2e-soon-" } }] } });
    await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await prisma.siteSetting.deleteMany({ where: { key: { startsWith: "e2e.clock." } } });
  };
  await cleanup();

  const setup = async (
    thread: string,
    opts: { startMin: number; name?: string; label?: string; minutes?: number; lastInboundMin?: number; createdMinAgo?: number; meetUrl?: string }
  ) => {
    const lastInboundAt = ago(opts.lastInboundMin ?? 60);
    const conv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: thread, metaAccountId: "test-phone-id", participantName: opts.name ?? "Rosa", status: "OPEN", lastMessageAt: lastInboundAt, lastInboundAt },
    });
    const startsAt = inMin(opts.startMin);
    const appt = await prisma.calendarAppointment.create({
      data: {
        eventId: `e2e-soon-${run}-${thread}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + (opts.minutes ?? 15) * 60_000),
        title: `${opts.label ?? "0/0"} ${opts.name ?? "Rosa"} +${thread}`,
        name: opts.name ?? "Rosa",
        phone: thread,
        sessionsLabel: opts.label ?? "0/0",
        meetUrl: opts.meetUrl ?? null,
        conversationId: conv.id,
        status: "active",
        matchState: "phone",
        // El reloj la vio hace tiempo (agendada con antelación), salvo que se diga otra cosa.
        createdAt: inMin(-(opts.createdMinAgo ?? 2 * 24 * 60)),
      },
    });
    return { conv, appt };
  };
  const reminders = (conversationId: string) =>
    prisma.conversationMessage.findMany({
      where: { conversationId, direction: "OUTBOUND", source: { startsWith: "recordatorio:1h:" } },
      select: { body: true, source: true, isAutoReply: true, status: true, clientKey: true },
    });
  const apptOf = (id: string) => prisma.calendarAppointment.findUniqueOrThrow({ where: { id } });

  try {
    const rosa = await setup(T.ROSA, { startMin: 55, name: "Rosa" });
    // De dónde escribe (su ficha): la hora va en la suya, no en la de Colombia.
    await prisma.whatsAppDossier.create({ data: { conversationId: rosa.conv.id, timezone: "America/Mexico_City" } });
    const paid = await setup(T.PAID, { startMin: 55, label: "3/10", minutes: 60, name: "Pedro" });
    // Agendada por la IA 40 min antes de la hora (la cita es en 30): la confirmación ya le dijo la hora.
    const late = await setup(T.LATE, { startMin: 30, name: "Lucía" });
    await prisma.whatsAppBooking.create({
      data: {
        conversationId: late.conv.id,
        phone: T.LATE,
        name: "Lucía",
        service: "Consulta gratis 15 min",
        startsAt: late.appt.startsAt,
        endsAt: late.appt.endsAt,
        googleAccountId: "e2e",
        calendarEventId: late.appt.eventId,
        createdAt: inMin(-10),
      },
    });
    const nowin = await setup(T.NOWIN, { startMin: 50, name: "Marta", lastInboundMin: 3 * 24 * 60 });
    const meet = await setup(T.MEET, { startMin: 55, name: "Sofía", meetUrl: "https://meet.google.com/abc-defg-hij" });
    const later = await setup(T.LATER, { startMin: 120, name: "Clara" });

    console.log("\n1. Llamada gratis en 55 min: sale el recordatorio, en su hora");
    const r1 = await sendSoonReminders({ now, config });
    check("1 enviado, 1 sin plantilla, 1 que no hacía falta, 0 fallos", r1.sent === 1 && r1.skipped === 1 && r1.notNeeded === 1 && r1.failed === 0, r1);
    const rosaMsgs = await reminders(rosa.conv.id);
    const body = rosaMsgs[0]?.body ?? "";
    const mxTime = getTimeLabelInTz(rosa.appt.startsAt, "America/Mexico_City");
    check("le llega a Rosa, con su nombre y la voz de la asistente", body.startsWith("Hola Rosa 🙏 Te recuerdo que hoy a las") && body.includes("Dayana te llamará por WhatsApp"), body);
    check("con la hora de su zona (México), con a. m./p. m.", body.includes(`a las ${mxTime} Dayana`) && /\d:\d{2} [ap]\. m\./.test(body), { body, mxTime });
    check("que tenga un espacio tranquilo; sin corazones ni «lista»", body.includes("ten a mano un espacio tranquilo") && !/💛|❤|\blist[ao]\b/u.test(body), body);
    check("queda en el chat como envío automático", rosaMsgs.length === 1 && rosaMsgs[0].isAutoReply && rosaMsgs[0].status !== "FAILED" && Boolean(rosaMsgs[0].clientKey?.startsWith("reminder:1h:")), rosaMsgs);
    const rosaAppt = await apptOf(rosa.appt.id);
    check("la cita queda marcada (sin error)", Boolean(rosaAppt.reminderSoonSentAt) && !rosaAppt.reminderSoonError && !rosaAppt.reminderSoonSkipped, rosaAppt);

    console.log("\n2. No se repite");
    const r2 = await sendSoonReminders({ now: inMin(3), config });
    check("una segunda pasada no manda nada", r2.sent === 0 && r2.failed === 0 && r2.skipped === 0 && r2.notNeeded === 0, r2);
    check("Rosa sigue con un solo recordatorio", (await reminders(rosa.conv.id)).length === 1);
    const twice = await setup(T.TWICE, { startMin: 45, name: "Elena" });
    const [a, b] = await Promise.all([sendSoonReminders({ now, config }), sendSoonReminders({ now, config })]);
    check("dos pasadas a la vez: sale una sola vez", a.sent + b.sent === 1 && (await reminders(twice.conv.id)).length === 1, { a, b });

    console.log("\n3. Una sesión pagada a la misma hora: nada");
    const paidAppt = await apptOf(paid.appt.id);
    check("ni mensaje ni marca", !paidAppt.reminderSoonSentAt && (await reminders(paid.conv.id)).length === 0, paidAppt);

    console.log("\n4. Agendada 40 min antes: no hace falta");
    const lateAppt = await apptOf(late.appt.id);
    check("se marca con el motivo y no se manda", Boolean(lateAppt.reminderSoonSentAt) && Boolean(lateAppt.reminderSoonSkipped?.includes("40 min")) && (await reminders(late.conv.id)).length === 0, lateAppt);

    console.log("\n5. Fuera de las 24 h, sin la plantilla aprobada");
    const nowinAppt = await apptOf(nowin.appt.id);
    check(
      "no sale y queda el motivo (aprobar la plantilla)",
      Boolean(nowinAppt.reminderSoonSentAt) && Boolean(nowinAppt.reminderSoonError?.includes("Llamada gratis: recordatorio de hoy")) && (await reminders(nowin.conv.id)).length === 0,
      nowinAppt
    );

    console.log("\n6. Con Meet o dentro de 2 h: nada (todavía)");
    const meetAppt = await apptOf(meet.appt.id);
    const laterAppt = await apptOf(later.appt.id);
    check("la de Meet no es la llamada por WhatsApp", !meetAppt.reminderSoonSentAt && (await reminders(meet.conv.id)).length === 0, meetAppt);
    check("la de dentro de 2 h espera su hora", !laterAppt.reminderSoonSentAt, laterAppt);
    const r3 = await sendSoonReminders({ now: inMin(55), config });
    check("una hora después, a la de las 2 h sí le llega", r3.sent === 1 && (await reminders(later.conv.id)).length === 1, r3);

    console.log("\n7. El turno del reloj");
    check("el primero toma el turno", await claimClockSlot(TEST_CLOCK_KEY, 5 * 60_000, now));
    check("enseguida no le toca a nadie", !(await claimClockSlot(TEST_CLOCK_KEY, 5 * 60_000, inMin(1))));
    const race = await Promise.all([1, 2, 3, 4].map(() => claimClockSlot(TEST_CLOCK_KEY, 5 * 60_000, inMin(6))));
    check("cuatro a la vez después del intervalo: gana uno solo", race.filter(Boolean).length === 1, race);
    const fresh = await Promise.all([1, 2, 3].map(() => claimClockSlot(`${TEST_CLOCK_KEY}.nuevo`, 5 * 60_000, now)));
    check("con la fila sin crear, también gana uno solo", fresh.filter(Boolean).length === 1, fresh);

    await prisma.siteSetting.deleteMany({ where: { key: { in: [CLOCK_SYNC_KEY, CLOCK_REMINDERS_KEY, CLOCK_FOLLOWUP_KEY, CLOCK_PENDING_KEY] } } });
    const calls: string[] = [];
    const deps = (at: Date) => ({
      now: at,
      sync: async () => void calls.push("citas"),
      dayBefore: async () => void calls.push("24h"),
      soon: async () => void calls.push("1h"),
      followUp: async () => void calls.push("seguimiento"),
      pending: async () => void calls.push("pendientes"),
    });
    const t1 = await runClockTick(deps(now));
    check(
      "primera pasada: citas, 24 h, 1 h, seguimiento y pendientes",
      calls.join() === "citas,24h,1h,seguimiento,pendientes" && t1.every((s) => s.ok),
      { calls, t1 }
    );
    calls.length = 0;
    const t2 = await runClockTick(deps(inMin(2)));
    check("a los 2 min no le toca nada", t2.length === 0 && calls.length === 0, { calls, t2 });
    const t3 = await runClockTick(deps(inMin(6)));
    check("a los 6 min solo los recordatorios y el seguimiento", calls.join() === "24h,1h,seguimiento" && t3.length === 3, { calls, t3 });
    calls.length = 0;
    const t4 = await runClockTick({ ...deps(inMin(16)), sync: async () => { throw new Error("Google no responde"); } });
    check("a los 16 min las citas otra vez; si fallan, no lanza y los recordatorios siguen", t4[0]?.name === "citas" && !t4[0].ok && calls.join() === "24h,1h,seguimiento,pendientes", t4);
    await setWhatsAppAiConfig({ ...config, freeCallReminder: { ...config.freeCallReminder, enabled: false } });
    calls.length = 0;
    const t5 = await runClockTick({
      now: inMin(22),
      sync: async () => undefined,
      dayBefore: async () => undefined,
      followUp: async () => undefined,
      pending: async () => undefined,
    });
    const soonStep = t5.find((s) => s.name === "recordatorio 1 h");
    check("apagado en Ajustes, el de 1 h no corre", JSON.stringify(soonStep?.result) === JSON.stringify({ off: true }), t5);
  } finally {
    await cleanup();
    await setWhatsAppAiConfig(previous);
    if (previousProvider) await prisma.siteSetting.update({ where: { key: "whatsapp.provider" }, data: { value: previousProvider.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.provider" } });
    if (previousReminders) {
      await prisma.siteSetting.upsert({
        where: { key: previousReminders.key },
        create: { key: previousReminders.key, value: previousReminders.value },
        update: { value: previousReminders.value },
      });
    }
    await prisma.siteSetting.deleteMany({ where: { key: { in: [CLOCK_SYNC_KEY, CLOCK_REMINDERS_KEY, CLOCK_FOLLOWUP_KEY, CLOCK_PENDING_KEY] } } });
    for (const row of previousClock) await prisma.siteSetting.create({ data: { key: row.key, value: row.value } });
    for (const t of previousTemplate) await prisma.messageTemplate.update({ where: { id: t.id }, data: { metaApprovalStatus: t.metaApprovalStatus } });
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Recordatorio de 1 h OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
