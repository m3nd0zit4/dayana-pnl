/**
 * ¿Se hizo la llamada gratis? Contra la base de DESARROLLO, con un calendario
 * de mentira y sin IA (todo sale de reglas). Envíos en modo prueba.
 *
 *   bun scripts/whatsapp-call-outcome-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Después de la llamada ella escribe «no me llamaron»: no contestó, y se le
 *    manda el mensaje para reagendar con horas libres (que quedan ofrecidas).
 * 2. El chat no dice nada: se le pregunta «¿Pudiste hablar con Dayana?» (y la
 *    barra del chat lo dice); responde «Sí, gracias»: contestó, y no se le
 *    manda nada más.
 * 3. Responde «No, se me pasó»: no contestó y se le mandan horas.
 * 4. Se le preguntó hace 25 h y no respondió: se da por no contestada.
 * 5. Una sesión pagada no entra en esto. 6. Si ya tiene otra llamada agendada: «se reagendó».
 * 7. La primera vez que corre el reloj: una llamada de hace 8 h sin señales no
 *    recibe la pregunta (queda para Dayana); con «no me llamaron» sí se decide
 *    y se le mandan horas (< 24 h); una de hace 30 h se decide sin mensaje.
 * 8. Dayana marca «Hablaron»: queda `manual`, sin mensaje; la barra se va.
 * 9. Dayana marca «No contestó» dentro de las 24 h: horas para reagendar,
 *    registradas como ofrecidas.
 * 10. «No contestó» fuera de las 24 h sin la plantilla aprobada:
 *     `needs_template`, no sale nada. 11. Chat en manual: `silenced`.
 * 12. Ya decidida: `already_decided`.
 * 13. El reloj pegado a los avisos corre el seguimiento una vez por turno, no
 *     con el interruptor apagado, y sin la dependencia de prueba corre el
 *     barrido de verdad.
 * 14. Dayana tocó «Hablaron» por error (Leidy, 16-oct): la línea «Cambiar» del
 *     chat lo muestra; pasa a «No contestó» sin mensaje, queda en la auditoría
 *     y se puede volver a cambiar. 15. A «No contestó» con horas: salen una
 *     sola vez. 16. «No contestó · sin mensaje» al marcar. 17. Con «La IA
 *     responde siempre», un chat en manual sí recibe las horas.
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
  const { setFreeCallCalendarForTests, offeredFreeCallSlots } = await import("@/lib/crm/whatsapp-agent/free-call");
  const { sweepCallOutcomes, handleCallFollowUpReply, markCallOutcome, changeCallOutcome } = await import("@/lib/crm/whatsapp-agent/call-outcome");
  const { getChat } = await import("@/lib/crm/whatsapp-agent/workspace");
  const { CLOCK_FOLLOWUP_KEY, CLOCK_PENDING_KEY, CLOCK_REMINDERS_KEY, CLOCK_SYNC_KEY, runClockTick } = await import("@/lib/crm/whatsapp-agent/tick");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  if (!(await resolveDryRun())) throw new Error("WhatsApp no está en modo prueba (NOTIFICATIONS_DRY_RUN): no sigo.");

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

  const T = {
    NO: "573000003311",
    ASK_YES: "573000003312",
    ASK_NO: "573000003313",
    TIMEOUT: "573000003314",
    PAID: "573000003315",
    RESCHED: "573000003316",
    OLD_QUIET: "573000003317",
    OLD_MISSED: "573000003318",
    STALE_MISSED: "573000003319",
    MAN_YES: "573000003320",
    MAN_NO: "573000003321",
    MAN_NOWIN: "573000003322",
    MAN_MANUAL: "573000003323",
    MAN_NOMSG: "573000003324",
    ALWAYS: "573000003325",
  };
  const THREADS = Object.values(T);
  const TEMPLATE_KEYS = ["cita_no_contestada", "cita_seguimiento"];
  const CLOCK_KEYS = [CLOCK_SYNC_KEY, CLOCK_REMINDERS_KEY, CLOCK_FOLLOWUP_KEY, CLOCK_PENDING_KEY];

  const previous = await getWhatsAppAiConfig();
  const previousProvider = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
  const previousEnabled = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.autoreply.enabled" } });
  const previousClock = await prisma.siteSetting.findMany({ where: { key: { in: CLOCK_KEYS } } });
  // Si las plantillas estuvieran aprobadas en esta base, quedan pendientes durante la prueba.
  const previousTemplates = await prisma.messageTemplate.findMany({ where: { key: { in: TEMPLATE_KEYS } }, select: { id: true, metaApprovalStatus: true } });
  await prisma.messageTemplate.updateMany({ where: { key: { in: TEMPLATE_KEYS } }, data: { metaApprovalStatus: "PENDING" } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({ where: { key: "whatsapp.autoreply.enabled" }, create: { key: "whatsapp.autoreply.enabled", value: "true" }, update: { value: "true" } });
  const config = { ...previous, defaultMode: "COPILOT" as const, booking: { ...previous.booking, enabled: true }, callFollowUp: { enabled: true, askAfterMin: 10, assumeMissedAfterHours: 24 } };
  await setWhatsAppAiConfig(config);
  const staff = await prisma.staffUser.findFirst({ select: { id: true } });

  const cleanup = async () => {
    const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } }, select: { id: true } });
    const ids = convs.map((c) => c.id);
    const appts = await prisma.calendarAppointment.findMany({ where: { OR: [{ conversationId: { in: ids } }, { eventId: { startsWith: "e2e-outcome-" } }] }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: "CalendarAppointment", entityId: { in: appts.map((a) => a.id) } } });
    await prisma.calendarAppointment.deleteMany({ where: { id: { in: appts.map((a) => a.id) } } });
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  };
  await cleanup();

  let n = 0;
  const setup = async (
    thread: string,
    opts: { minutesAgo?: number; label?: string; length?: number; lastInboundHoursAgo?: number; aiModeOverride?: "MANUAL"; always?: boolean } = {}
  ) => {
    const lastInboundAt = new Date(now.getTime() - (opts.lastInboundHoursAgo ?? 1) * 3600_000);
    const conv = await prisma.conversation.create({
      data: {
        channel: "WHATSAPP",
        externalThreadId: thread,
        metaAccountId: "test-phone-id",
        participantName: "Lucía",
        status: "OPEN",
        lastMessageAt: lastInboundAt,
        lastInboundAt,
        aiModeOverride: opts.aiModeOverride ?? null,
        aiAlwaysAt: opts.always ? new Date() : null,
      },
    });
    // Escribió antes de la llamada (con la ventana de 24 h abierta, salvo que se diga otra cosa).
    await prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        direction: "INBOUND",
        status: "DELIVERED",
        externalMessageId: `wamid.e2e.outcome.${Date.now()}.${n++}`,
        body: "Perfecto, ahí estaré",
        sentAt: opts.lastInboundHoursAgo ? lastInboundAt : new Date(now.getTime() - 3 * 3600_000),
      },
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
  const RESCHEDULE = /no lograron comunicarse/;

  try {
    console.log("\n1. Escribe «no me llamaron»");
    const a = await setup(T.NO);
    await write(a.conv.id, "Hola, no me llamaron, sigo esperando");
    await sweepCallOutcomes(config, now);
    const a1 = await apptOf(a.appt.id);
    check("no contestó (según el chat)", a1.callOutcome === "no_answer" && a1.callOutcomeSource === "chat", a1);
    const aOut = await outbound(a.conv.id);
    check("se le mandó el mensaje para reagendar con horas", aOut.some((m) => RESCHEDULE.test(m.body ?? "") && /•/.test(m.body ?? "")), aOut);
    check("con a. m./p. m. y sin «atentos»", aOut.some((m) => /\d:\d{2}\s[ap]\.\s?m\./.test(m.body ?? "")) && !aOut.some((m) => /atent[oa]s/.test(m.body ?? "")), aOut);
    const offered = await offeredFreeCallSlots(a.conv.id);
    check("esas horas quedan ofrecidas (si elige una, se agenda)", offered.includes(new Date(fakeSlots[0].startIso).toISOString()), offered);

    console.log("\n2. El chat no dice nada → se pregunta; responde que sí");
    const b = await setup(T.ASK_YES);
    const bBefore = await getChat(b.conv.id);
    check("antes de preguntar, la barra del chat pide marcarla (sin «ya le preguntó»)", bBefore?.callFollowUp?.appointmentId === b.appt.id && !bBefore.callFollowUp.asked, bBefore?.callFollowUp);
    check("la barra dice cuándo fue, con a. m./p. m.", /^(de hoy|de ayer|del \S+ \d{1,2} de \S+), \d{1,2}:\d{2} [ap]\. m\.$/.test(bBefore?.callFollowUp?.when ?? ""), bBefore?.callFollowUp);
    await sweepCallOutcomes(config, now);
    const b1 = await apptOf(b.appt.id);
    check("se le preguntó", Boolean(b1.outcomeCheckAt) && (await outbound(b.conv.id)).some((m) => /Pudiste hablar con Dayana/.test(m.body ?? "")));
    check("la barra del chat dice que la asistente ya le preguntó", (await getChat(b.conv.id))?.callFollowUp?.asked === true);
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
    check("con otra llamada gratis agendada, la barra del chat no sale", (await getChat(f.conv.id))?.callFollowUp === null);
    await sweepCallOutcomes(config, now);
    const f1 = await apptOf(f.appt.id);
    check("se reagendó, sin mensajes", f1.callOutcome === "rescheduled" && (await outbound(f.conv.id)).length === 0, f1);

    console.log("\n7. La primera vez que corre el reloj (llamadas de hace horas)");
    // Terminó hace 8 h (más de las 6 h para preguntar) y el chat no dice nada.
    const g = await setup(T.OLD_QUIET, { minutesAgo: 8 * 60 + 15 });
    // Terminó hace 8 h y después escribió que no la llamaron.
    const h = await setup(T.OLD_MISSED, { minutesAgo: 8 * 60 + 15 });
    await write(h.conv.id, "Buenas, no me llamaron", new Date(now.getTime() - 7 * 3600_000));
    // Terminó hace 30 h y escribió «no me llamaron» hace 29 h.
    const k = await setup(T.STALE_MISSED, { minutesAgo: 30 * 60 + 15, lastInboundHoursAgo: 29 });
    await write(k.conv.id, "No me llamaron", new Date(now.getTime() - 29 * 3600_000));
    await sweepCallOutcomes(config, now);
    const g1 = await apptOf(g.appt.id);
    check("8 h sin señales: no se le pregunta nada y queda sin decidir", g1.callOutcome === null && !g1.outcomeCheckAt && (await outbound(g.conv.id)).length === 0, g1);
    check("…y la barra del chat se la deja a Dayana", (await getChat(g.conv.id))?.callFollowUp?.appointmentId === g.appt.id);
    const h1 = await apptOf(h.appt.id);
    check("8 h con «no me llamaron»: no contestó y se le mandan horas", h1.callOutcome === "no_answer" && h1.callOutcomeSource === "chat" && Boolean(h1.rescheduleSentAt), h1);
    const k1 = await apptOf(k.appt.id);
    check("30 h con «no me llamaron»: se decide, pero no se le escribe", k1.callOutcome === "no_answer" && !k1.rescheduleSentAt && (await outbound(k.conv.id)).length === 0, k1);
    await sweepCallOutcomes(config, new Date(now.getTime() + 10 * 60_000));
    check("otra pasada tampoco le escribe a la de 8 h", (await outbound(g.conv.id)).length === 0 && (await apptOf(g.appt.id)).callOutcome === null);

    console.log("\n8. Dayana marca «Hablaron»");
    const m = await setup(T.MAN_YES);
    const mYes = await markCallOutcome({ appointmentId: m.appt.id, outcome: "answered", staffUserId: staff?.id });
    const m1 = await apptOf(m.appt.id);
    check("queda como contestada, a mano, sin mensaje", mYes.ok && !mYes.sent && m1.callOutcome === "answered" && m1.callOutcomeSource === "manual" && (await outbound(m.conv.id)).length === 0, { mYes, m1 });
    check("la barra del chat se va", (await getChat(m.conv.id))?.callFollowUp === null);
    check("queda en la auditoría", (await prisma.auditLog.count({ where: { entityType: "CalendarAppointment", entityId: m.appt.id, action: "whatsapp.call_outcome.mark" } })) === 1);

    console.log("\n9. Dayana marca «No contestó» (escribió hace 1 h)");
    const p = await setup(T.MAN_NO);
    const mNo = await markCallOutcome({ appointmentId: p.appt.id, outcome: "no_answer", staffUserId: staff?.id });
    const p1 = await apptOf(p.appt.id);
    check("sale el mensaje para reagendar", mNo.ok && mNo.sent && !mNo.reason, mNo);
    check("queda como no contestada, a mano, con la hora del mensaje", p1.callOutcome === "no_answer" && p1.callOutcomeSource === "manual" && Boolean(p1.rescheduleSentAt), p1);
    const pOut = await outbound(p.conv.id);
    check("el mensaje lleva las horas libres", pOut.length === 1 && RESCHEDULE.test(pOut[0].body ?? "") && /•/.test(pOut[0].body ?? ""), pOut);
    const pOffered = await offeredFreeCallSlots(p.conv.id);
    check("las horas quedan ofrecidas", fakeSlots.every((s) => pOffered.includes(new Date(s.startIso).toISOString())), pOffered);

    console.log("\n10. «No contestó» fuera de las 24 h, sin la plantilla aprobada");
    const q = await setup(T.MAN_NOWIN, { lastInboundHoursAgo: 3 * 24 });
    const mOld = await markCallOutcome({ appointmentId: q.appt.id, outcome: "no_answer", staffUserId: staff?.id });
    const q1 = await apptOf(q.appt.id);
    check("needs_template y no sale nada", mOld.ok && !mOld.sent && mOld.reason === "needs_template" && (await outbound(q.conv.id)).length === 0, mOld);
    check("aun así queda como no contestada (sin mensaje)", q1.callOutcome === "no_answer" && q1.callOutcomeSource === "manual" && !q1.rescheduleSentAt, q1);

    console.log("\n11. «No contestó» en un chat en manual");
    const r = await setup(T.MAN_MANUAL, { aiModeOverride: "MANUAL" });
    const mQuiet = await markCallOutcome({ appointmentId: r.appt.id, outcome: "no_answer", staffUserId: staff?.id });
    check("silenced: se decide sin escribirle", mQuiet.ok && !mQuiet.sent && mQuiet.reason === "silenced" && (await outbound(r.conv.id)).length === 0, mQuiet);

    console.log("\n12. Ya decidida");
    const again = await markCallOutcome({ appointmentId: m.appt.id, outcome: "no_answer", staffUserId: staff?.id });
    check("already_decided, sin cambiar nada", !again.ok && again.error === "already_decided" && (await apptOf(m.appt.id)).callOutcome === "answered", again);
    const paidMark = await markCallOutcome({ appointmentId: e.appt.id, outcome: "answered" });
    check("una sesión pagada (ya «not_free») tampoco", !paidMark.ok && paidMark.error === "already_decided", paidMark);
    check("una cita que no existe: not_found", (await markCallOutcome({ appointmentId: "no-existe", outcome: "answered" })).ok === false);

    console.log("\n14. Tocó «Hablaron» por error y lo corrige");
    const mView = await getChat(m.conv.id);
    check(
      "el chat muestra la llamada marcada con «Cambiar» (Hablaron, a mano)",
      mView?.callDecided?.appointmentId === m.appt.id && mView.callDecided.outcome === "answered" && mView.callDecided.source === "manual",
      mView?.callDecided
    );
    const fix = await changeCallOutcome({ appointmentId: m.appt.id, outcome: "no_answer", sendHours: false, staffUserId: staff?.id });
    const m2 = await apptOf(m.appt.id);
    check(
      "pasa a «No contestó», a mano, sin mensaje",
      fix.ok && !fix.sent && m2.callOutcome === "no_answer" && m2.callOutcomeSource === "manual" && (await outbound(m.conv.id)).length === 0,
      { fix, m2 }
    );
    check(
      "queda en la auditoría como cambio",
      (await prisma.auditLog.count({ where: { entityType: "CalendarAppointment", entityId: m.appt.id, action: "whatsapp.call_outcome.change" } })) === 1
    );
    check("la línea del chat ya dice «No contestó»", (await getChat(m.conv.id))?.callDecided?.outcome === "no_answer");
    const same = await changeCallOutcome({ appointmentId: m.appt.id, outcome: "no_answer", sendHours: false });
    check("cambiar a lo mismo: same", !same.ok && same.error === "same", same);
    const back = await changeCallOutcome({ appointmentId: m.appt.id, outcome: "answered", sendHours: false });
    check("y se puede volver a «Hablaron»", back.ok && (await apptOf(m.appt.id)).callOutcome === "answered", back);
    const resched = await changeCallOutcome({ appointmentId: f.appt.id, outcome: "answered", sendHours: false });
    check("«se reagendó» (lo decidió el reloj) no se cambia desde aquí", !resched.ok && resched.error === "not_changeable", resched);

    console.log("\n15. A «No contestó» con horas: una sola vez");
    const toNo = await changeCallOutcome({ appointmentId: b.appt.id, outcome: "no_answer", sendHours: true, staffUserId: staff?.id });
    const b3 = await apptOf(b.appt.id);
    check("salen las horas para reagendar", toNo.ok && toNo.sent && Boolean(b3.rescheduleSentAt), { toNo, b3 });
    await changeCallOutcome({ appointmentId: b.appt.id, outcome: "answered", sendHours: false });
    const before = (await outbound(b.conv.id)).length;
    const toNoAgain = await changeCallOutcome({ appointmentId: b.appt.id, outcome: "no_answer", sendHours: true });
    check("si ya se le mandaron, no salen otra vez", toNoAgain.ok && !toNoAgain.sent && (await outbound(b.conv.id)).length === before, toNoAgain);

    console.log("\n16. «No contestó · sin mensaje» al marcar");
    const s16 = await setup(T.MAN_NOMSG);
    const quiet = await markCallOutcome({ appointmentId: s16.appt.id, outcome: "no_answer", sendHours: false, staffUserId: staff?.id });
    check(
      "no contestó y no sale nada",
      quiet.ok && !quiet.sent && !quiet.reason && (await outbound(s16.conv.id)).length === 0 && (await apptOf(s16.appt.id)).callOutcome === "no_answer",
      quiet
    );

    console.log("\n17. «La IA responde siempre» en un chat en manual");
    const s17 = await setup(T.ALWAYS, { aiModeOverride: "MANUAL", always: true });
    const loud = await markCallOutcome({ appointmentId: s17.appt.id, outcome: "no_answer", staffUserId: staff?.id });
    check("no está en silencio: le llegan las horas", loud.ok && loud.sent && (await outbound(s17.conv.id)).length === 1, loud);

    console.log("\n13. El reloj pegado a los avisos");
    await prisma.siteSetting.deleteMany({ where: { key: { in: CLOCK_KEYS } } });
    let sweeps = 0;
    let pendings = 0;
    const noop = async () => undefined;
    const deps = (at: Date) => ({
      now: at,
      sync: noop,
      dayBefore: noop,
      soon: noop,
      followUp: async () => ({ sweep: ++sweeps }),
      pending: async () => ({ pending: ++pendings }),
    });
    const inMin = (min: number) => new Date(now.getTime() + min * 60_000);
    const t1 = await runClockTick(deps(now));
    check("primera pasada: corre el seguimiento", sweeps === 1 && t1.some((s) => s.name === "seguimiento llamadas" && s.ok), t1);
    const t2 = await runClockTick(deps(inMin(2)));
    check("a los 2 min no le toca", sweeps === 1 && !t2.some((s) => s.name === "seguimiento llamadas"), t2);
    await Promise.all([runClockTick(deps(inMin(6))), runClockTick(deps(inMin(6))), runClockTick(deps(inMin(6)))]);
    check("a los 6 min, aunque lleguen tres avisos a la vez, corre una sola vez", sweeps === 2, { sweeps });
    check("«pendientes» (chats sin respuesta): en la primera pasada y no otra vez antes de 10 min", pendings === 1, { pendings });
    await setWhatsAppAiConfig({ ...config, callFollowUp: { ...config.callFollowUp, enabled: false } });
    const t4 = await runClockTick(deps(inMin(12)));
    const off = t4.find((s) => s.name === "seguimiento llamadas");
    check("con el interruptor apagado no corre", sweeps === 2 && JSON.stringify(off?.result) === JSON.stringify({ off: true }), t4);
    await setWhatsAppAiConfig(config);
    check("«pendientes» vuelve a los 10 min", pendings === 2, { pendings });
    const t5 = await runClockTick({ now: inMin(18), sync: noop, dayBefore: noop, soon: noop, pending: noop });
    const real = t5.find((s) => s.name === "seguimiento llamadas");
    check(
      "sin la dependencia de prueba corre el barrido de verdad",
      Boolean(real?.ok) && typeof (real?.result as { checked?: unknown } | undefined)?.checked === "number",
      t5
    );
  } finally {
    setFreeCallCalendarForTests({});
    await cleanup();
    await setWhatsAppAiConfig(previous);
    if (previousProvider) await prisma.siteSetting.update({ where: { key: "whatsapp.provider" }, data: { value: previousProvider.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.provider" } });
    if (previousEnabled) await prisma.siteSetting.update({ where: { key: "whatsapp.autoreply.enabled" }, data: { value: previousEnabled.value } });
    await prisma.siteSetting.deleteMany({ where: { key: { in: CLOCK_KEYS } } });
    for (const row of previousClock) await prisma.siteSetting.create({ data: { key: row.key, value: row.value } });
    for (const t of previousTemplates) await prisma.messageTemplate.update({ where: { id: t.id }, data: { metaApprovalStatus: t.metaApprovalStatus } });
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallos:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\n✅ Seguimiento de llamadas: todo bien");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
