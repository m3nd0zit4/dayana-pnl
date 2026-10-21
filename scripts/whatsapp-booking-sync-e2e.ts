/**
 * La reserva de la llamada gratis y el calendario de Dayana, de acuerdo.
 * Contra la base de DESARROLLO, con un calendario DE MENTIRA (nunca el de
 * Dayana) y sin modelo.
 *
 *   bun scripts/whatsapp-booking-sync-e2e.ts
 *
 * Auditoría del 21-oct sobre `main`:
 * 1. Dayana mueve en Google la llamada que agendó la IA: la reserva pasa a la
 *    hora nueva (antes la IA le seguía diciendo la vieja y la hora vieja
 *    seguía «ocupada»).
 * 2. Dayana la borra: la reserva queda cancelada (antes seguía en «llamada
 *    agendada» y ocupaba un cupo del día); si el evento vuelve, la reserva también.
 * 3. La llamada que Dayana puso a mano cuenta como «ya tiene llamada» y en el
 *    tope del día; una sesión pagada o «Llamar al banco» no. La IA no la mueve.
 * 4. Una sesión pagada ni bloquea ni tapa la llamada gratis.
 * 5. Dos reservas casi a la vez no quedan pegadas: el respiro también en la base.
 *
 * Todas las fechas van dentro de ~400 días: la limpieza de `syncAppointments`
 * (lo que no está en el calendario se cancela) solo mira la ventana de esas
 * fechas y no toca las citas de otras pruebas.
 */
import type { CalendarEvent } from "@/lib/google/calendar";

export {};

process.env.NOTIFICATIONS_DRY_RUN = "true";

const DAY = 86_400_000;

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  const { prisma } = await import("@/lib/db");
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database()::text AS db`;
  if (db !== "neondb_dev") throw new Error(`Solo contra neondb_dev (esta conexión es ${db}).`);

  const { getWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { bookFreeCall, moveFreeCall, offerFreeCallSlotsFor, setFreeCallCalendarForTests, upcomingFreeCall, FreeCallError } = await import(
    "@/lib/crm/whatsapp-agent/free-call"
  );
  const { syncAppointments } = await import("@/lib/crm/whatsapp-agent/appointments");
  const { computeSegment } = await import("@/lib/crm/whatsapp-agent/segment-store");
  const { zonedDateTimeToUtc, getDateKeyInTz } = await import("@/lib/datetime/zoned-time");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    if (!ok) failures.push(name);
  };
  const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
      return "ok";
    } catch (e) {
      return e instanceof FreeCallError ? e.code : String(e);
    }
  };

  const TZ = "America/Bogota";
  const run = Date.now();
  const at = (day: number, hhmm: string) => zonedDateTimeToUtc(getDateKeyInTz(new Date(run + (400 + day) * DAY), TZ), hhmm, TZ);
  const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
  const NOW = at(0, "06:00");
  const slot = (d: Date) => ({ startIso: d.toISOString(), endIso: plus(d, 15).toISOString(), dateKey: getDateKeyInTz(d, TZ), time: "" });

  // El calendario de Dayana, de mentira: lo que la IA agenda o mueve y lo que ella pone, mueve o borra.
  const calendar = new Map<string, CalendarEvent>();
  const eventId = (tag: string) => `e2e-bsync-${run}-${tag}`;
  const put = (id: string, summary: string, start: Date, minutes: number, extra: Partial<CalendarEvent> = {}) => {
    calendar.set(id, { id, summary, start: { dateTime: start.toISOString() }, end: { dateTime: plus(start, minutes).toISOString() }, ...extra });
  };
  let made = 0;
  let offered: Date[] = [];
  setFreeCallCalendarForTests({
    available: async () => offered.map(slot),
    book: async (input) => {
      const id = eventId(`ai-${++made}`);
      const title = `0/0 ${input.name ?? ""} +${input.phone}`.replace(/\s+/g, " ");
      put(id, title, input.start, input.durationMin);
      return { accountId: "e2e", eventId: id, meetUrl: null, eventUrl: null, title, end: plus(input.start, input.durationMin) };
    },
    move: async (input) => {
      const ev = calendar.get(input.eventId);
      if (ev) put(input.eventId, ev.summary ?? "", input.start, input.durationMin);
      return { end: plus(input.start, input.durationMin) };
    },
  });
  const sync = () => syncAppointments({ events: [...calendar.values()], now: NOW, patchTitle: async () => undefined });

  const base = await getWhatsAppAiConfig();
  // Valores fijos (no los de Ajustes en dev): respiro de 10 min y tope alto salvo donde se prueba.
  const config = { ...base, booking: { ...base.booking, bufferMin: 10 }, freeCall: { ...base.freeCall, maxPerDay: 6 } };
  const capped = { ...config, freeCall: { ...config.freeCall, maxPerDay: 1 } };

  const convIds: string[] = [];
  const newChat = async (k: number, name: string) => {
    const phone = `5730${String(run).slice(-6)}${String(k).padStart(2, "0")}`;
    const conv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: phone, metaAccountId: "test-phone-id", participantName: name },
    });
    convIds.push(conv.id);
    return { id: conv.id, phone };
  };
  const book = (cfg: typeof config, chat: { id: string; phone: string }, start: Date) =>
    bookFreeCall({ config: cfg, dayanaTz: TZ, personTz: TZ, start, conversationId: chat.id, contactId: null, phone: chat.phone, name: "Prueba" });

  try {
    console.log("\n1. Dayana mueve en Google la llamada que agendó la IA");
    const ana = await newChat(1, "Ana Prueba");
    const A1 = at(1, "10:00");
    const A2 = at(2, "15:00");
    const booked = await book(config, ana, A1);
    await sync();
    check("al principio: la llamada a la hora agendada", (await upcomingFreeCall(ana.id, config, NOW))?.startsAt.getTime() === A1.getTime());
    check("y su estado es «llamada agendada»", (await computeSegment(ana.id))?.segment === "free_call_booked");
    const aiEvent = (await prisma.whatsAppBooking.findUniqueOrThrow({ where: { id: booked.bookingId } })).calendarEventId;
    put(aiEvent, calendar.get(aiEvent)?.summary ?? "", A2, 15);
    const r1 = await sync();
    const afterMove = await prisma.whatsAppBooking.findUniqueOrThrow({ where: { id: booked.bookingId } });
    check(
      "la reserva pasó a la hora nueva",
      afterMove.startsAt.getTime() === A2.getTime() && afterMove.endsAt.getTime() === plus(A2, 15).getTime() && afterMove.status === "BOOKED",
      afterMove
    );
    check("el reloj lo cuenta y avisa qué chat cambió", r1.bookingsUpdated === 1 && r1.bookingChats.includes(ana.id), r1);
    const upcoming = await upcomingFreeCall(ana.id, config, NOW);
    check("la IA ve la hora nueva («ya tiene su llamada…»)", upcoming?.startsAt.getTime() === A2.getTime() && upcoming?.source === "booking", upcoming);
    const bea = await newChat(2, "Bea Prueba");
    check("la hora vieja quedó libre para otra persona", (await codeOf(() => book(config, bea, A1))) === "ok");

    console.log("\n2. Dayana la borra (y luego la restaura)");
    const moved = calendar.get(aiEvent)!;
    calendar.delete(aiEvent);
    const r2 = await sync();
    const afterDelete = await prisma.whatsAppBooking.findUniqueOrThrow({ where: { id: booked.bookingId } });
    const apptGone = await prisma.calendarAppointment.findUniqueOrThrow({ where: { eventId: aiEvent } });
    check("la reserva queda cancelada, como la cita", afterDelete.status === "CANCELLED" && apptGone.status === "cancelled", { afterDelete, apptGone: apptGone.status });
    check("el reloj lo cuenta", r2.bookingsCancelled === 1 && r2.bookingChats.includes(ana.id), r2);
    check("la IA ya no le dice que tiene llamada", (await upcomingFreeCall(ana.id, config, NOW)) === null);
    const segment = await computeSegment(ana.id);
    check("ya no está en «llamada agendada»", segment?.segment !== "free_call_booked", segment);
    const cami = await newChat(3, "Cami Prueba");
    check("ese día ya no cuenta para el tope (máx. 1)", (await codeOf(() => book(capped, cami, at(2, "17:00")))) === "ok");
    // Una llamada borrada no ocupa el cupo de su día.
    const gus = await newChat(10, "Gus Prueba");
    const gusBooking = await book(capped, gus, at(10, "10:00"));
    await sync();
    calendar.delete((await prisma.whatsAppBooking.findUniqueOrThrow({ where: { id: gusBooking.bookingId } })).calendarEventId);
    await sync();
    const hugo = await newChat(11, "Hugo Prueba");
    check("una llamada borrada ya no llena su día (máx. 1)", (await codeOf(() => book(capped, hugo, at(10, "11:00")))) === "ok");
    calendar.set(aiEvent, moved);
    await sync();
    const restored = await prisma.whatsAppBooking.findUniqueOrThrow({ where: { id: booked.bookingId } });
    check("Dayana la restauró: la reserva vuelve a estar en pie", restored.status === "BOOKED" && restored.startsAt.getTime() === A2.getTime(), restored);

    console.log("\n3. La llamada que Dayana puso a mano");
    const mia = await newChat(4, "Mia Manual");
    const M1 = at(3, "11:00");
    put(eventId("manual"), `0/0 Mia Manual +${mia.phone}`, M1, 15);
    const paid = await newChat(5, "Pablo Paga");
    put(eventId("paid-session"), `3.6 Pablo Paga +${paid.phone}`, at(3, "16:00"), 60, { hangoutLink: "https://meet.google.com/abc-defg-hij" });
    put(eventId("errand"), `Llamar banco zq${run}`, at(6, "09:00"), 15);
    await sync();
    const manual = await upcomingFreeCall(mia.id, config, NOW);
    check("la IA la ve como su llamada", manual?.source === "calendar" && manual.startsAt.getTime() === M1.getTime(), manual);
    check("no se le agenda otra", (await codeOf(() => book(config, mia, at(4, "11:00")))) === "already_booked");
    const dani = await newChat(6, "Dani Prueba");
    check("cuenta en el tope del día (máx. 1)", (await codeOf(() => book(capped, dani, at(3, "08:00")))) === "daily_cap");
    offered = [at(3, "08:30"), at(5, "10:00")];
    const offer = await offerFreeCallSlotsFor({ config: capped, personTz: TZ, dayanaTz: TZ, now: NOW });
    check("y ese día no se ofrece", offer.options.length === 1 && offer.options[0].startIso === at(5, "10:00").toISOString(), offer.options);
    check("la IA no la mueve (la cambia Dayana)", (await codeOf(() => moveFreeCall({ config, dayanaTz: TZ, personTz: TZ, bookingId: manual!.id, start: at(5, "10:00") }))) === "not_movable");
    check("una sesión pagada no es su llamada gratis", (await upcomingFreeCall(paid.id, config, NOW)) === null);
    check("y no le impide agendarla", (await codeOf(() => book(config, paid, at(5, "10:00")))) === "ok");
    const eli = await newChat(7, "Eli Prueba");
    check("«Llamar al banco» de 15 min no cuenta en el tope", (await codeOf(() => book(capped, eli, at(6, "16:00")))) === "ok");

    console.log("\n4. Una sesión pagada ni bloquea ni tapa la llamada gratis");
    const sara = await newChat(8, "Sara Sesion");
    const S1 = at(7, "09:00");
    await prisma.whatsAppBooking.create({
      data: {
        conversationId: sara.id,
        phone: sara.phone,
        name: "Sara",
        service: "Sesión de terapia",
        startsAt: S1,
        endsAt: plus(S1, 60),
        googleAccountId: "e2e",
        calendarEventId: eventId("paid-booking"),
        meetUrl: "https://meet.google.com/xyz-abcd-efg",
        status: "BOOKED",
      },
    });
    put(eventId("paid-booking"), `1/4 Sara Sesion +${sara.phone}`, S1, 60, { hangoutLink: "https://meet.google.com/xyz-abcd-efg" });
    await sync();
    check("la sesión no es «su llamada gratis» (la IA no la movería)", (await upcomingFreeCall(sara.id, config, NOW)) === null);
    const F1 = at(7, "15:00");
    check("se le agenda la llamada gratis", (await codeOf(() => book(config, sara, F1))) === "ok");
    const found = await upcomingFreeCall(sara.id, config, NOW);
    check("la que se ve es la llamada, no la sesión de antes", found?.source === "booking" && found.startsAt.getTime() === F1.getTime(), found);
    check("y una segunda no", (await codeOf(() => book(config, sara, at(8, "10:00")))) === "already_booked");

    console.log("\n5. El respiro también en la base (dos reservas casi a la vez)");
    const rosa = await newChat(9, "Rosa Prueba");
    const lina = await newChat(0, "Lina Prueba");
    check("10:00 se agenda", (await codeOf(() => book(config, rosa, at(9, "10:00")))) === "ok");
    // El calendario de mentira lo acepta todo: como si Google aún no viera la otra.
    check("10:15, pegada y sin respiro: ocupada", (await codeOf(() => book(config, lina, at(9, "10:15")))) === "unavailable");
    check("10:25 (10 min de respiro): libre", (await codeOf(() => book(config, lina, at(9, "10:25")))) === "ok");
    await sync();
    const linaBooking = await prisma.whatsAppBooking.findFirstOrThrow({ where: { conversationId: lina.id } });
    check(
      "mover sin respiro tampoco (9:40 termina 9:55)",
      (await codeOf(() => moveFreeCall({ config, dayanaTz: TZ, personTz: TZ, bookingId: linaBooking.id, start: at(9, "09:40") }))) === "unavailable"
    );
    check(
      "con respiro sí (9:35 termina 9:50)",
      (await codeOf(() => moveFreeCall({ config, dayanaTz: TZ, personTz: TZ, bookingId: linaBooking.id, start: at(9, "09:35") }))) === "ok"
    );
  } finally {
    await prisma.calendarAppointment.deleteMany({ where: { eventId: { startsWith: `e2e-bsync-${run}` } } });
    await prisma.whatsAppBooking.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ La reserva y el calendario de acuerdo");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
