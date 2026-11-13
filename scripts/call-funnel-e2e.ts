/**
 * El embudo de la llamada gratis en la web (`lib/crm/call-funnel/`), de punta a
 * punta contra la base de DESARROLLO, con personas de prueba que se borran al
 * final. El calendario es el de mentira (fuera de producción nunca se toca el
 * de Dayana) y no sale nada por WhatsApp.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/call-funnel-e2e.ts
 *
 * 1. Paso 1: contacto nuevo con su origen (Instagram), la etiqueta, su chat y
 *    la fila del embudo con de dónde llegó.
 * 2. El mismo número otra vez, con otro nombre: otro enlace, nadie se renombra.
 * 3. Paso 2: respuestas guardadas, una sola nota en el contacto, el correo
 *    completa el que faltaba; un enlace que no existe no guarda nada.
 * 4. Horas: pocos días, pocas por día.
 * 5. Una hora que no se ofrece no se agenda; una que sí, queda en la agenda
 *    del CRM y en su página.
 * 6. Esa hora deja de ofrecerse.
 * 7. El mismo número desde otro enlace: «ya tiene llamada» (sin decir cuándo).
 * 8. Otra persona, la misma hora: «se ocupó», con las horas de ahora.
 * 9. Cambiar de hora mueve la misma cita: nunca quedan dos.
 * 10. «Confirmar por WhatsApp» queda marcado.
 * 11. El CRM: una fila por persona, con su canal, sus respuestas y su cita.
 * 12. Cancelar libera la hora; cancelar dos veces no hace nada.
 * 13. Canceló y vuelve a agendar desde el mismo enlace.
 * 14. Tope por conexión: la tercera cita del día desde la misma no se agenda.
 * 15. Con la página cerrada no hay horas ni se agenda.
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  if (process.env.VERCEL_ENV === "production" || process.env.CALL_FUNNEL_REAL_CALENDAR === "1") {
    throw new Error("Esta prueba solo corre con el calendario de mentira.");
  }
  process.env.NOTIFICATIONS_DRY_RUN = "true";
  const { prisma } = await import("@/lib/db");
  const { bookCall, CALL_FUNNEL_TAG, cancelCall, funnelSlots, funnelStats, getCallForIcs, getFunnelPage, listFunnelLeads, noteConfirmClick, saveAnswers, startLead } =
    await import("@/lib/crm/call-funnel/server");
  const { CALL_FUNNEL_SETTING_KEY, getCallFunnelConfig, setCallFunnelConfig } = await import("@/lib/crm/call-funnel/config");
  const { EMPTY_ATTRIBUTION } = await import("@/lib/crm/call-funnel/rules");
  const { usesRealCalendar, LOCAL_EVENT_PREFIX } = await import("@/lib/crm/call-funnel/calendar");
  const { getWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
  };

  if (usesRealCalendar()) throw new Error("El calendario no es el de mentira.");
  const ai = await getWhatsAppAiConfig();
  if (!ai.booking.enabled) throw new Error("La agenda de la IA está apagada en neondb_dev: sin ella no hay horas que probar.");

  const run = Date.now().toString().slice(-6);
  const phone = (n: number) => `300${n}${run}`; // celular colombiano de prueba
  const start = (n: number, firstName: string, over: Record<string, unknown> = {}) =>
    startLead({
      firstName,
      lastName: null,
      phone: phone(n),
      phoneCountry: "CO",
      consentMarketing: false,
      timezone: "America/Mexico_City",
      attribution: { ...EMPTY_ATTRIBUTION, utmSource: "instagram", utmCampaign: `e2e-${run}`, landingPath: "/llamada" },
      ...over,
    });
  const ok = <T extends { status: string }>(r: T) => {
    if (r.status !== "ok") throw new Error(`se esperaba ok: ${JSON.stringify(r)}`);
    return r as Extract<T, { status: "ok" }>;
  };

  const contactIds = new Set<string>();
  const conversationIds = new Set<string>();
  const hadSetting = await prisma.siteSetting.findUnique({ where: { key: CALL_FUNNEL_SETTING_KEY } });

  try {
    // Con los ajustes de siempre, pase lo que pase en la base de desarrollo.
    await setCallFunnelConfig({ enabled: true, days: 3, perDay: 6, bookingsPerIpPerDay: 2 });

    // 1 ────────────────────────────────────────────────────────────────────
    const a = ok(await start(1, "Ana"));
    contactIds.add(a.contactId);
    if (a.conversationId) conversationIds.add(a.conversationId);
    const contactA = await prisma.contact.findUniqueOrThrow({ where: { id: a.contactId }, include: { tags: { include: { tag: true } } } });
    const leadA = await prisma.callFunnelLead.findUniqueOrThrow({ where: { token: a.token } });
    check("1. contacto nuevo, con su origen", a.created && a.firstTime && contactA.source === "INSTAGRAM", { source: contactA.source });
    check("1. detalle del origen", contactA.sourceDetail === `Llamada gratis en la web (Instagram · campaña e2e-${run})`, contactA.sourceDetail);
    check("1. permiso de datos anotado, el de marketing no", Boolean(contactA.consentDataAt) && !contactA.consentMarketingAt);
    check("1. su zona horaria es la del navegador", contactA.timezone === "America/Mexico_City", contactA.timezone);
    check("1. etiqueta", contactA.tags.some((t) => t.tag.slug === CALL_FUNNEL_TAG.slug));
    check("1. tiene chat de WhatsApp", Boolean(a.conversationId));
    check("1. la fila guarda de dónde llegó", leadA.utmSource === "instagram" && leadA.utmCampaign === `e2e-${run}` && leadA.landingPath === "/llamada");
    check("1. el enlace es largo y no adivinable", /^[A-Za-z0-9_-]{32}$/.test(a.token), a.token.length);

    // 2 ────────────────────────────────────────────────────────────────────
    const a2 = ok(await start(1, "Otra Persona"));
    const contactA2 = await prisma.contact.findUniqueOrThrow({ where: { id: a.contactId } });
    check("2. mismo contacto, otro enlace", a2.contactId === a.contactId && a2.token !== a.token && !a2.created && !a2.firstTime);
    check("2. nadie se renombra desde el formulario", contactA2.firstName === "Ana", contactA2.firstName);
    check("2. el mismo chat", a2.conversationId === a.conversationId);

    // 3 ────────────────────────────────────────────────────────────────────
    const email = `e2e-llamada-${run}@example.com`;
    const saved = await saveAnswers(a.token, { topic: "ansiedad", urgency: "ya", goal: null, invest: null, interests: [], occupation: null, social: null, committed: true, note: "Me cuesta dormir.", email });
    await saveAnswers(a.token, { topic: null, urgency: "mes", goal: "marca", invest: "si", interests: ["sesiones", "talleres"], occupation: null, social: "@ana.e2e", committed: true, note: null, email: null });
    const afterAnswers = await prisma.contact.findUniqueOrThrow({ where: { id: a.contactId } });
    const leadAnswered = await prisma.callFunnelLead.findUniqueOrThrow({ where: { token: a.token } });
    check("3. respuestas guardadas (la última gana)", saved && (leadAnswered.answers as { goal?: string } | null)?.goal === "marca", leadAnswered.answers);
    check("3. una sola nota en el contacto", (afterAnswers.notes?.match(/Pidió su llamada gratis/g) ?? []).length === 1, afterAnswers.notes);
    check("3. la nota dice qué quiere trabajar", Boolean(afterAnswers.notes?.includes("Hoy: Ansiedad y miedo")), afterAnswers.notes);
    check("3. el correo completa el que faltaba", afterAnswers.email === email, afterAnswers.email);
    check("3. un enlace que no existe no guarda nada", !(await saveAnswers("x".repeat(32), { topic: "otro", urgency: "ya", goal: null, invest: null, interests: [], occupation: null, social: null, committed: false, note: null, email: null })));

    // 4 ────────────────────────────────────────────────────────────────────
    const slots = await funnelSlots();
    if (slots.state !== "ok") throw new Error(`sin horas en neondb_dev: ${JSON.stringify(slots)}`);
    const days = new Set(slots.slots.map((s) => s.dateKey));
    const perDay = Math.max(...[...days].map((d) => slots.slots.filter((s) => s.dateKey === d).length));
    check("4. hay horas", slots.slots.length >= 3, slots.slots.length);
    check("4. máximo 3 días y 6 horas por día", days.size <= 3 && perDay <= 6, { days: days.size, perDay });
    check("4. todas en el futuro", slots.slots.every((s) => Date.parse(s.startIso) > Date.now()));
    // Tres horas separadas entre sí (una cita tapa también su respiro).
    const first = slots.slots[0];
    const second = slots.slots[Math.floor(slots.slots.length / 2)];
    const third = slots.slots[slots.slots.length - 1];

    // 4b ───────────────────────────────────────────────────────────────────
    // El horario de Dayana manda: ni se ofrece ni se deja agendar un día o una
    // hora que ella no abrió (por ejemplo un martes, si no atiende los martes).
    const openWeekdays = new Set(ai.booking.hours.map((h) => h.weekday));
    const weekdayOf = (iso: string) => new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: slots.dayanaTz }).format(new Date(iso))}T12:00:00Z`).getUTCDay();
    check("4b. solo días que Dayana abrió", slots.bookable.every((s) => openWeekdays.has(weekdayOf(s.startIso))), [...new Set(slots.bookable.map((s) => weekdayOf(s.startIso)))]);
    const closedDay = [0, 1, 2, 3, 4, 5, 6].find((d) => !openWeekdays.has(d));
    if (closedDay !== undefined) {
      // La próxima fecha de ese día de la semana, a las 10:00 de Dayana (UTC-5 en Bogotá).
      const probe = new Date();
      do probe.setUTCDate(probe.getUTCDate() + 1);
      while (probe.getUTCDay() !== closedDay || probe.getTime() < Date.now() + 5 * 86_400_000);
      probe.setUTCHours(15, 0, 0, 0);
      const forced = await bookCall(a.token, probe.toISOString());
      check("4b. forzar un día cerrado no agenda", forced.status === "unavailable", forced.status);
    }

    // 5 ────────────────────────────────────────────────────────────────────
    const notOffered = await bookCall(a.token, new Date(Date.parse(first.startIso) + 60_000).toISOString());
    check("5. una hora que no se ofrece no se agenda", notOffered.status === "unavailable" && notOffered.slots.length > 0, notOffered.status);
    const booked = await bookCall(a.token, first.startIso);
    check("5. agenda la hora elegida", booked.status === "booked" && !booked.moved && booked.startIso === first.startIso, booked);
    const leadBooked = await prisma.callFunnelLead.findUniqueOrThrow({ where: { token: a.token } });
    const booking = await prisma.whatsAppBooking.findUniqueOrThrow({ where: { id: leadBooked.bookingId! } });
    const appointment = await prisma.calendarAppointment.findUnique({ where: { eventId: booking.calendarEventId } });
    check("5. la reserva es la de la llamada gratis", booking.status === "BOOKED" && booking.conversationId === a.conversationId, booking.status);
    check("5. el evento es de mentira (nunca en el calendario de Dayana)", booking.calendarEventId.startsWith(LOCAL_EVENT_PREFIX), booking.calendarEventId);
    check("5. queda en la Agenda del CRM", appointment?.status === "active" && appointment.contactId === a.contactId, appointment?.status);
    const page = await getFunnelPage(a.token);
    check("5. su página: agendada, con su hora", page?.stage === "agendada" && page.call?.startIso === first.startIso && page.canChange, page?.stage);
    check("5. su página: confirmar, calendario y .ics", Boolean(page?.confirmUrl?.includes("wa.me") && page.googleCalendarUrl && page.icsPath?.endsWith("/calendario")));
    check("5. el mensaje de confirmación va en SU hora (México)", Boolean(page?.confirmUrl && decodeURIComponent(page.confirmUrl).includes("Ana")));
    check("5. el .ics tiene la cita", (await getCallForIcs(a.token))?.startIso === first.startIso);

    // 6 ────────────────────────────────────────────────────────────────────
    const afterBooking = await funnelSlots();
    check("6. esa hora ya no se ofrece ni se puede agendar", afterBooking.state === "ok" && !afterBooking.bookable.some((s) => s.startIso === first.startIso));

    // 7 ────────────────────────────────────────────────────────────────────
    const again = await bookCall(a2.token, second.startIso);
    check("7. el mismo número desde otro enlace: ya tiene llamada", again.status === "already_booked", again);
    check("7. su otra página no muestra la cita de nadie", (await getFunnelPage(a2.token))?.call === null);

    // 8 ────────────────────────────────────────────────────────────────────
    const b = ok(await start(2, "Beto"));
    contactIds.add(b.contactId);
    if (b.conversationId) conversationIds.add(b.conversationId);
    const taken = await bookCall(b.token, first.startIso);
    check("8. otra persona, la misma hora: se ocupó", taken.status === "unavailable" && !taken.slots.some((s) => s.startIso === first.startIso), taken.status);

    // 9 ────────────────────────────────────────────────────────────────────
    const moved = await bookCall(a.token, third.startIso);
    const bookingsA = await prisma.whatsAppBooking.findMany({ where: { conversationId: a.conversationId! } });
    check("9. cambiar de hora mueve la misma cita", moved.status === "booked" && moved.moved && moved.startIso === third.startIso, moved);
    check("9. sigue habiendo una sola", bookingsA.length === 1 && bookingsA[0].startsAt.toISOString() === third.startIso, bookingsA.length);
    const afterMove = await funnelSlots();
    check("9. la hora anterior vuelve a estar libre", afterMove.state === "ok" && afterMove.bookable.some((s) => s.startIso === first.startIso));

    // 10 ───────────────────────────────────────────────────────────────────
    check("10. sin confirmar todavía", (await getFunnelPage(a.token))?.confirmed === false);
    await noteConfirmClick(a.token);
    check("10. confirmó por WhatsApp", (await getFunnelPage(a.token))?.confirmed === true);

    // 11 ───────────────────────────────────────────────────────────────────
    const rows = (await listFunnelLeads()).filter((r) => contactIds.has(r.contactId));
    const rowA = rows.find((r) => r.contactId === a.contactId);
    const rowB = rows.find((r) => r.contactId === b.contactId);
    check("11. una fila por persona", rows.length === 2, rows.length);
    check("11. Ana: agendada, confirmó, vino 2 veces", rowA?.stage === "agendada" && rowA.confirmed && rowA.visits === 2, rowA);
    check("11. Ana: canal y respuestas", rowA?.channel === "instagram" && rowA.campaign === `e2e-${run}` && rowA.interests.join(",") === "Sesiones de coaching 1 a 1,Talleres" && rowA.goal === "Vivir de mi marca personal y mi contenido" && rowA.social === "@ana.e2e", rowA);
    check("11. Ana: su hora", rowA?.call?.startIso === third.startIso);
    check("11. Beto: dejó sus datos", rowB?.stage === "datos" && rowB.call === null && !rowB.confirmed, rowB?.stage);
    const stats = funnelStats(rows);
    check("11. los números", stats.leads === 2 && stats.booked === 1 && stats.confirmed === 1 && stats.toFollowUp === 1 && stats.answered === 1, stats);

    // 12 ───────────────────────────────────────────────────────────────────
    const cancelled = await cancelCall(a.token);
    const bookingAfter = await prisma.whatsAppBooking.findUniqueOrThrow({ where: { id: booking.id } });
    const apptAfter = await prisma.calendarAppointment.findUnique({ where: { eventId: booking.calendarEventId } });
    check("12. cancela", cancelled.status === "cancelled" && bookingAfter.status === "CANCELLED" && apptAfter?.status === "cancelled", cancelled);
    check("12. su página: cancelada, sin cita", ((p) => p?.stage === "cancelada" && p.call === null && !p.canChange)(await getFunnelPage(a.token)));
    check("12. cancelar dos veces no hace nada", (await cancelCall(a.token)).status === "nothing");
    const afterCancel = await funnelSlots();
    check("12. la hora queda libre", afterCancel.state === "ok" && afterCancel.bookable.some((s) => s.startIso === third.startIso));

    // 13 ───────────────────────────────────────────────────────────────────
    const rebooked = await bookCall(a.token, second.startIso);
    check("13. vuelve a agendar desde el mismo enlace", rebooked.status === "booked" && !rebooked.moved, rebooked);
    check("13. su página vuelve a «agendada»", (await getFunnelPage(a.token))?.stage === "agendada");
    await cancelCall(a.token);

    // 14 ───────────────────────────────────────────────────────────────────
    const ip = `203.0.113.${Number(run) % 250}`;
    const people = [];
    for (const n of [3, 4, 5]) {
      const p = ok(await start(n, `Persona ${n}`));
      contactIds.add(p.contactId);
      if (p.conversationId) conversationIds.add(p.conversationId);
      people.push(p);
    }
    const free = await funnelSlots();
    if (free.state !== "ok" || free.slots.length < 3) throw new Error("no hay 3 horas libres para probar el tope");
    // Horas separadas (una cita tapa también su respiro, antes y después).
    const pick = [free.slots[0], free.slots[Math.floor(free.slots.length / 2)], free.slots[free.slots.length - 1]];
    const r1 = await bookCall(people[0].token, pick[0].startIso, { ip });
    const r2 = await bookCall(people[1].token, pick[1].startIso, { ip });
    const r3 = await bookCall(people[2].token, pick[2].startIso, { ip });
    check("14. dos citas desde la misma conexión", r1.status === "booked" && r2.status === "booked", [r1.status, r2.status]);
    check("14. la tercera no se agenda", r3.status === "closed", r3);
    const other = await bookCall(people[2].token, pick[2].startIso, { ip: "198.51.100.7" });
    check("14. desde otra conexión, sí", other.status === "booked", other);

    // 15 ───────────────────────────────────────────────────────────────────
    await setCallFunnelConfig({ enabled: false });
    const closed = await funnelSlots();
    check("15. página cerrada: sin horas", closed.state === "unavailable" && closed.reason === "closed", closed);
    check("15. página cerrada: no se agenda", (await bookCall(b.token, second.startIso)).status === "closed");
    await setCallFunnelConfig({ enabled: true });
    check("15. abierta otra vez", (await getCallFunnelConfig()).enabled && (await funnelSlots()).state === "ok");
  } finally {
    // Los avisos al equipo salen después de responder: se espera a que terminen antes de borrar.
    await new Promise((r) => setTimeout(r, 2500));
    const chats = [...conversationIds];
    const people = [...contactIds];
    const events = (await prisma.whatsAppBooking.findMany({ where: { conversationId: { in: chats } }, select: { calendarEventId: true } })).map(
      (b) => b.calendarEventId
    );
    await prisma.calendarAppointment.deleteMany({ where: { OR: [{ eventId: { in: events } }, { conversationId: { in: chats } }] } });
    await prisma.platformNotification.deleteMany({ where: { OR: [{ entityId: { in: [...chats, ...people] } }] } });
    await prisma.callFunnelLead.deleteMany({ where: { contactId: { in: people } } });
    await prisma.conversation.deleteMany({ where: { id: { in: chats } } });
    await prisma.contact.deleteMany({ where: { id: { in: people } } });
    if (hadSetting) await prisma.siteSetting.update({ where: { key: CALL_FUNNEL_SETTING_KEY }, data: { value: hadSetting.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: CALL_FUNNEL_SETTING_KEY } });
  }

  if (failures.length) {
    console.error(`\n${failures.length} fallos:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTodo bien.");
  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
