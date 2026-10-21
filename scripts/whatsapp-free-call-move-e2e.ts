/**
 * La llamada gratis: moverla a otra hora y el tope del día. Contra la base de
 * DESARROLLO, con un calendario DE MENTIRA (nunca el de Dayana) y sin modelo.
 *
 *   bun scripts/whatsapp-free-call-move-e2e.ts
 *
 * 1. Alexandra (21-oct): tenía el jueves y pidió el viernes; la IA le confirmó
 *    el viernes sin cita. Ahora la que tiene se mueve: una sola reserva, una
 *    sola cita en la agenda, a la hora nueva y con los recordatorios en cero.
 * 2. Natalia / Barbara (21-oct): se ofrecían horas de hoy aunque el día ya
 *    tenía el tope (las llamadas de la mañana no contaban) y al agendar salía
 *    «Ese día ya no hay cupos». Ahora un día lleno no se ofrece.
 */
export {};

process.env.NOTIFICATIONS_DRY_RUN = "true";

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { bookFreeCall, moveFreeCall, offerFreeCallSlotsFor, setFreeCallCalendarForTests, FreeCallError } = await import(
    "@/lib/crm/whatsapp-agent/free-call"
  );
  const { zonedDateTimeToUtc, getDateKeyInTz } = await import("@/lib/datetime/zoned-time");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const TZ = "America/Bogota";
  const run = Date.now();
  const at = (daysAhead: number, hhmm: string) => {
    const key = getDateKeyInTz(new Date(Date.now() + daysAhead * 86_400_000), TZ);
    return zonedDateTimeToUtc(key, hhmm, TZ);
  };
  const slot = (d: Date) => ({ startIso: d.toISOString(), endIso: new Date(d.getTime() + 15 * 60_000).toISOString(), dateKey: getDateKeyInTz(d, TZ), time: "" });

  const thu = at(2, "12:30");
  const fri = at(3, "09:00");
  const moves: { eventId: string; start: Date }[] = [];
  setFreeCallCalendarForTests({
    available: async () => [slot(thu), slot(fri)],
    book: async (input) => ({
      accountId: "e2e-account",
      eventId: `e2e-move-${run}`,
      meetUrl: null,
      eventUrl: null,
      title: "0/0 Prueba Mover +573000008899",
      end: new Date(input.start.getTime() + input.durationMin * 60_000),
    }),
    move: async (input) => {
      moves.push({ eventId: input.eventId, start: input.start });
      return { end: new Date(input.start.getTime() + input.durationMin * 60_000) };
    },
  });

  const config = await getWhatsAppAiConfig();
  const conv = await prisma.conversation.create({
    data: { channel: "WHATSAPP", externalThreadId: `57300000${String(run).slice(-4)}`, metaAccountId: "test-phone-id", participantName: "Prueba Mover" },
  });
  const created: string[] = [];

  try {
    console.log("\n1. Mover la llamada que ya tiene (Alexandra)");
    const booking = await bookFreeCall({
      config,
      dayanaTz: TZ,
      personTz: TZ,
      start: thu,
      conversationId: conv.id,
      contactId: null,
      phone: conv.externalThreadId,
      name: "Prueba",
    });
    created.push(booking.bookingId);
    // El reloj ya le había mandado el recordatorio de 24 h a la hora vieja.
    await prisma.calendarAppointment.update({ where: { eventId: `e2e-move-${run}` }, data: { reminderSentAt: new Date() } });

    const moved = await moveFreeCall({ config, dayanaTz: TZ, personTz: TZ, bookingId: booking.bookingId, start: fri });
    check("se movió el mismo evento del calendario", moves.length === 1 && moves[0].eventId === `e2e-move-${run}` && moves[0].start.getTime() === fri.getTime(), moves);
    const rows = await prisma.whatsAppBooking.findMany({ where: { conversationId: conv.id }, select: { startsAt: true, status: true } });
    check("una sola reserva, a la hora nueva", rows.length === 1 && rows[0].startsAt.getTime() === fri.getTime(), rows);
    const appts = await prisma.calendarAppointment.findMany({ where: { conversationId: conv.id }, select: { startsAt: true, reminderSentAt: true, status: true } });
    check("una sola cita en la agenda, a la hora nueva", appts.length === 1 && appts[0].startsAt.getTime() === fri.getTime(), appts);
    check("el recordatorio vuelve a salir para la hora nueva", appts[0]?.reminderSentAt === null, appts[0]);
    check("la etiqueta es la del viernes", moved.label.includes("9:00"), moved.label);

    // Si el calendario no la deja mover, la reserva vuelve a su hora (no queda a medias).
    const { SlotUnavailableError } = await import("@/lib/crm/whatsapp-agent/calendar");
    setFreeCallCalendarForTests({
      available: async () => [slot(thu), slot(fri)],
      move: async () => {
        throw new SlotUnavailableError("Esa hora ya se ocupó.");
      },
    });
    let failed = "";
    try {
      await moveFreeCall({ config, dayanaTz: TZ, personTz: TZ, bookingId: booking.bookingId, start: thu });
    } catch (e) {
      failed = e instanceof FreeCallError ? e.code : String(e);
    }
    const after = await prisma.whatsAppBooking.findUniqueOrThrow({ where: { id: booking.bookingId }, select: { startsAt: true } });
    check("el calendario no la movió: sigue el viernes", failed === "unavailable" && after.startsAt.getTime() === fri.getTime(), { failed, at: after.startsAt });

    console.log("\n2. El tope del día cuenta todo el día (Natalia, Barbara)");
    const today = getDateKeyInTz(new Date(), TZ);
    const earlier = new Date(Date.now() - 60 * 60_000);
    const later = new Date(Date.now() + 3 * 60 * 60_000);
    const sameDay = getDateKeyInTz(earlier, TZ) === today && getDateKeyInTz(later, TZ) === today;
    if (!sameDay) {
      console.log("  ⏭️  cerca de medianoche: se salta esta parte");
    } else {
      const capped = { ...config, freeCall: { ...config.freeCall, maxPerDay: 1, soonFirst: true } };
      const other = await prisma.conversation.create({
        data: { channel: "WHATSAPP", externalThreadId: `57300001${String(run).slice(-4)}`, metaAccountId: "test-phone-id" },
      });
      // Una llamada de esta mañana (ya pasó) llena el día.
      const morning = await prisma.whatsAppBooking.create({
        data: {
          conversationId: other.id,
          phone: other.externalThreadId,
          service: (await import("@/lib/crm/whatsapp-agent/free-call")).freeCallService(config).name,
          startsAt: earlier,
          endsAt: new Date(earlier.getTime() + 15 * 60_000),
          googleAccountId: "e2e",
          calendarEventId: `e2e-morning-${run}`,
          status: "BOOKED",
        },
      });
      setFreeCallCalendarForTests({ available: async () => [slot(later), slot(fri)] });
      const offer = await offerFreeCallSlotsFor({ config: capped, personTz: TZ, dayanaTz: TZ });
      check("hoy ya no se ofrece (la de la mañana cuenta)", !offer.options.some((o) => o.startIso === later.toISOString()), offer.options);
      let refused = "";
      try {
        await bookFreeCall({ config: capped, dayanaTz: TZ, personTz: TZ, start: later, conversationId: other.id, contactId: null, phone: other.externalThreadId, name: null });
      } catch (e) {
        refused = e instanceof FreeCallError ? e.code : String(e);
      }
      check("y agendar hoy dice lo mismo (sin cupos)", refused === "daily_cap", refused);
      await prisma.whatsAppBooking.delete({ where: { id: morning.id } });
      await prisma.conversation.delete({ where: { id: other.id } });
    }
  } finally {
    await prisma.calendarAppointment.deleteMany({ where: { eventId: { startsWith: `e2e-move-${run}` } } });
    await prisma.whatsAppBooking.deleteMany({ where: { conversationId: conv.id } });
    await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => undefined);
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Mover la llamada y el tope del día OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
