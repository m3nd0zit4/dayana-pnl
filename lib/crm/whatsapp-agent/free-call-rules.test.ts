import { describe, expect, test } from "bun:test";

import {
  bookingFollowsEvent,
  countedFreeCalls,
  dualZoneLabel,
  freeCallsPerDay,
  isCalendarFreeCall,
  isFreeCallBooking,
  listedUntil,
  pickUpcomingFreeCall,
  respiroRange,
  slotLabel,
} from "./free-call-rules";
import { overlapsBusy } from "./slots";

const at = (iso: string) => new Date(iso);
const FREE = { name: "Consulta gratis 15 min" };
// Jueves 22-oct-2026, 10:00 a. m. en Bogotá (15:00 UTC).
const T1 = at("2026-10-22T15:00:00Z");
const T2 = at("2026-10-23T14:00:00Z");
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

const booking = (over: Partial<Parameters<typeof isFreeCallBooking>[0]> & { id?: string; status?: string; calendarEventId?: string } = {}) => ({
  id: "b1",
  service: FREE.name,
  startsAt: T1,
  endsAt: plus(T1, 15),
  meetUrl: null as string | null,
  status: "BOOKED",
  calendarEventId: "ev-1",
  ...over,
});

const appt = (over: Partial<Parameters<typeof isCalendarFreeCall>[0]> & { id?: string; eventId?: string } = {}) => ({
  id: "a1",
  eventId: "ev-manual",
  title: "0/0 Ana Prueba +573001112233",
  sessionsLabel: "0/0" as string | null,
  meetUrl: null as string | null,
  startsAt: T2,
  endsAt: plus(T2, 15),
  phone: "573001112233" as string | null,
  contactId: null as string | null,
  conversationId: "conv-1" as string | null,
  ...over,
});

describe("isFreeCallBooking (auditoría 21-oct: `isFreeCallService(servicio, 15)` daba sí a todo)", () => {
  test("la reserva con el servicio de la llamada gratis lo es", () => {
    expect(isFreeCallBooking(booking(), FREE)).toBe(true);
    expect(isFreeCallBooking(booking({ service: "  consulta GRATIS 15 min " }), FREE)).toBe(true);
  });

  test("una sesión pagada de 60 min con Meet no lo es (antes bloqueaba la llamada gratis)", () => {
    expect(isFreeCallBooking(booking({ service: "Sesión de terapia", endsAt: plus(T1, 60), meetUrl: "https://meet.google.com/abc-defg-hij" }), FREE)).toBe(false);
    expect(isFreeCallBooking(booking({ service: "Sesión de terapia", endsAt: plus(T1, 60) }), FREE)).toBe(false);
  });

  test("si el servicio se llamaba distinto, cuenta por su nombre y su propia duración", () => {
    expect(isFreeCallBooking(booking({ service: "Llamada de valoración" }), FREE)).toBe(true);
    expect(isFreeCallBooking(booking({ service: "Llamada de valoración", meetUrl: "https://meet.google.com/abc-defg-hij" }), FREE)).toBe(false);
  });
});

describe("isCalendarFreeCall (la llamada gratis que Dayana puso a mano, sin reserva de la IA)", () => {
  test("«0/0 Nombre +número», 15 min, sin Meet: es la llamada gratis", () => {
    expect(isCalendarFreeCall(appt())).toBe(true);
    // Sin contador pero ligada a una persona por su número.
    expect(isCalendarFreeCall(appt({ title: "Ana Prueba +573001112233", sessionsLabel: null }))).toBe(true);
  });

  test("una sesión pagada nunca: contador, Meet, más de 20 min o «terapia»/«sesión» en el título", () => {
    expect(isCalendarFreeCall(appt({ title: "3.6 jesus terapia", sessionsLabel: "3/6", endsAt: plus(T2, 60) }))).toBe(false);
    expect(isCalendarFreeCall(appt({ title: "3.6 jesus terapia", sessionsLabel: "3/6" }))).toBe(false);
    expect(isCalendarFreeCall(appt({ meetUrl: "https://meet.google.com/abc-defg-hij" }))).toBe(false);
    expect(isCalendarFreeCall(appt({ endsAt: plus(T2, 60) }))).toBe(false);
    expect(isCalendarFreeCall(appt({ title: "jesus terapia +573001112233", sessionsLabel: null }))).toBe(false);
    expect(isCalendarFreeCall(appt({ title: "Sesión Ana +573001112233", sessionsLabel: null }))).toBe(false);
  });

  test("un rato corto sin persona no es una llamada gratis («Llamar al banco»)", () => {
    expect(isCalendarFreeCall(appt({ title: "Llamar al banco", sessionsLabel: null, phone: null, conversationId: null }))).toBe(false);
    // Con «0/0» sí: es como Dayana escribe la llamada gratis, aunque aún no se sepa de quién es.
    expect(isCalendarFreeCall(appt({ title: "0/0 Ana", phone: null, conversationId: null }))).toBe(true);
  });
});

describe("pickUpcomingFreeCall", () => {
  const now = at("2026-10-21T12:00:00Z");

  test("la reserva de la IA de este chat", () => {
    expect(pickUpcomingFreeCall({ bookings: [booking()], appointments: [], service: FREE, now })).toEqual({
      id: "b1",
      startsAt: T1,
      calendarEventId: "ev-1",
      source: "booking",
    });
  });

  test("sin reserva, la que Dayana puso a mano en su calendario (antes se agendaba otra)", () => {
    expect(pickUpcomingFreeCall({ bookings: [], appointments: [appt()], service: FREE, now })).toEqual({
      id: "a1",
      startsAt: T2,
      calendarEventId: "ev-manual",
      source: "calendar",
    });
  });

  test("una sesión pagada no es la llamada gratis (ni reserva ni cita)", () => {
    const paid = booking({ service: "Sesión de terapia", endsAt: plus(T1, 60), meetUrl: "https://meet.google.com/abc-defg-hij" });
    const session = appt({ title: "3.6 jesus terapia", sessionsLabel: "3/6", endsAt: plus(T2, 60), meetUrl: "https://meet.google.com/abc-defg-hij" });
    expect(pickUpcomingFreeCall({ bookings: [paid], appointments: [session], service: FREE, now })).toBeNull();
  });

  test("con una sesión pagada antes, sigue encontrando la llamada gratis", () => {
    const paid = booking({ id: "paid", service: "Sesión de terapia", startsAt: at("2026-10-21T20:00:00Z"), endsAt: at("2026-10-21T21:00:00Z"), calendarEventId: "ev-paid" });
    expect(pickUpcomingFreeCall({ bookings: [paid, booking()], appointments: [], service: FREE, now })?.id).toBe("b1");
  });

  test("la cita de una reserva es la misma llamada: gana la reserva", () => {
    const own = appt({ id: "a-own", eventId: "ev-1", startsAt: T1, endsAt: plus(T1, 15) });
    expect(pickUpcomingFreeCall({ bookings: [booking()], appointments: [own], service: FREE, now })?.source).toBe("booking");
  });

  test("la más próxima; nada de lo que ya pasó ni de lo cancelado", () => {
    const later = booking({ startsAt: at("2026-10-30T15:00:00Z"), endsAt: at("2026-10-30T15:15:00Z") });
    expect(pickUpcomingFreeCall({ bookings: [later], appointments: [appt()], service: FREE, now })?.source).toBe("calendar");
    const past = booking({ startsAt: at("2026-10-20T15:00:00Z"), endsAt: at("2026-10-20T15:15:00Z") });
    expect(pickUpcomingFreeCall({ bookings: [past], appointments: [], service: FREE, now })).toBeNull();
    expect(pickUpcomingFreeCall({ bookings: [booking({ status: "CANCELLED" })], appointments: [], service: FREE, now })).toBeNull();
  });
});

describe("countedFreeCalls / freeCallsPerDay (el tope diario)", () => {
  const TZ = "America/Bogota";

  test("la reserva y su cita son una sola llamada; la puesta a mano también cuenta", () => {
    const own = appt({ id: "a-own", eventId: "ev-1", startsAt: T1, endsAt: plus(T1, 15) });
    const manual = appt({ id: "a-manual", eventId: "ev-manual", startsAt: plus(T1, 60), endsAt: plus(T1, 75) });
    const calls = countedFreeCalls({ bookings: [booking()], appointments: [own, manual], service: FREE });
    expect(calls.map((c) => c.eventId).sort()).toEqual(["ev-1", "ev-manual"]);
    expect(freeCallsPerDay(calls, TZ).get("2026-10-22")).toBe(2);
  });

  test("no cuentan las sesiones pagadas, lo cancelado ni lo que no es de nadie", () => {
    const paid = booking({ id: "paid", service: "Sesión de terapia", endsAt: plus(T1, 60), calendarEventId: "ev-paid" });
    const cancelled = booking({ id: "gone", status: "CANCELLED", calendarEventId: "ev-gone" });
    const errand = appt({ id: "a-bank", eventId: "ev-bank", title: "Llamar al banco", sessionsLabel: null, phone: null, conversationId: null });
    const session = appt({ id: "a-session", eventId: "ev-session", title: "3.6 jesus terapia", sessionsLabel: "3/6", meetUrl: "https://meet.google.com/abc-defg-hij" });
    expect(countedFreeCalls({ bookings: [paid, cancelled], appointments: [errand, session], service: FREE })).toEqual([]);
  });

  test("una reserva que aún no tiene evento (en curso) cuenta", () => {
    const pending = booking({ status: "PENDING", calendarEventId: "pending:conv-1:2026-10-22T15:00:00.000Z" });
    expect(countedFreeCalls({ bookings: [pending], appointments: [], service: FREE })).toHaveLength(1);
  });
});

describe("respiroRange (el respiro entre citas también en la base: auditoría 21-oct)", () => {
  // Una reserva de 12:00 a 12:15 y respiro de 7 min (Dayana, 19-oct).
  const taken = { startsAt: at("2026-10-22T17:00:00Z"), endsAt: at("2026-10-22T17:15:00Z") };
  const overlaps = (start: Date, bufferMin: number) => {
    const { from, to } = respiroRange(start, plus(start, 15), bufferMin);
    return taken.startsAt < to && taken.endsAt > from;
  };

  test("pegada a otra (12:15) está ocupada; con el respiro (12:25) no", () => {
    expect(overlaps(at("2026-10-22T17:15:00Z"), 7)).toBe(true);
    expect(overlaps(at("2026-10-22T17:25:00Z"), 7)).toBe(false);
    // Antes: 11:50–12:05 sí choca; 11:38 termina 11:53, 7 min antes: libre.
    expect(overlaps(at("2026-10-22T16:50:00Z"), 7)).toBe(true);
    expect(overlaps(at("2026-10-22T16:38:00Z"), 7)).toBe(false);
    // Sin respiro, el borde no choca (como antes).
    expect(overlaps(at("2026-10-22T17:15:00Z"), 0)).toBe(false);
  });

  test("dice lo mismo que `overlapsBusy` con el calendario", () => {
    const busy = [{ start: taken.startsAt.getTime(), end: taken.endsAt.getTime() }];
    for (let m = -40; m <= 40; m += 1) {
      const start = plus(taken.startsAt, m);
      for (const buffer of [0, 7, 15]) {
        expect(overlaps(start, buffer)).toBe(overlapsBusy(start.getTime(), plus(start, 15).getTime(), busy, buffer));
      }
    }
  });
});

describe("bookingFollowsEvent (la reserva sigue al calendario: auditoría 21-oct)", () => {
  const b = { startsAt: T1, endsAt: plus(T1, 15), status: "BOOKED" };
  const seenAtT1 = { startsAt: T1, endsAt: plus(T1, 15) };

  test("Dayana movió el evento en Google: la reserva pasa a la hora nueva", () => {
    expect(bookingFollowsEvent({ booking: b, event: { start: T2, end: plus(T2, 15) }, seenBefore: seenAtT1 })).toEqual({
      kind: "update",
      data: { startsAt: T2, endsAt: plus(T2, 15) },
    });
  });

  test("la primera vez que el reloj ve el evento, también", () => {
    expect(bookingFollowsEvent({ booking: b, event: { start: T2, end: plus(T2, 15) }, seenBefore: null }).kind).toBe("update");
  });

  test("la IA la está moviendo (reserva a la hora nueva, Google aún en la vieja): no se devuelve", () => {
    const moving = { ...b, startsAt: T2, endsAt: plus(T2, 15) };
    expect(bookingFollowsEvent({ booking: moving, event: { start: T1, end: plus(T1, 15) }, seenBefore: seenAtT1 })).toEqual({ kind: "keep" });
  });

  test("el evento volvió (Dayana lo restauró): la reserva vuelve a estar en pie", () => {
    expect(bookingFollowsEvent({ booking: { ...b, status: "CANCELLED" }, event: { start: T1, end: plus(T1, 15) }, seenBefore: null })).toEqual({
      kind: "update",
      data: { startsAt: T1, endsAt: plus(T1, 15), status: "BOOKED" },
    });
  });

  test("todo igual: nada", () => {
    expect(bookingFollowsEvent({ booking: b, event: { start: T1, end: plus(T1, 15) }, seenBefore: seenAtT1 })).toEqual({ kind: "keep" });
  });
});

describe("listedUntil (lo que no se leyó no se borró)", () => {
  const windowEnd = at("2026-11-20T12:00:00Z");
  const ev = (iso: string) => ({ start: { dateTime: iso } });

  test("con menos eventos que el máximo, toda la ventana", () => {
    expect(listedUntil({ events: [ev("2026-10-22T15:00:00Z")], maxResults: 250, windowEnd })).toEqual(windowEnd);
  });

  test("Google cortó la lista: solo hasta antes del último evento leído", () => {
    const events = [ev("2026-10-22T15:00:00Z"), ev("2026-10-25T15:00:00Z"), { start: { date: "2026-10-24" } }];
    expect(listedUntil({ events, maxResults: 3, windowEnd })).toEqual(new Date(at("2026-10-25T15:00:00Z").getTime() - 1));
  });
});

describe("slotLabel / dualZoneLabel (las horas en su zona y en la de Colombia)", () => {
  const iso = "2026-10-22T20:00:00Z"; // 3:00 p. m. en Bogotá, 2:00 p. m. en Ciudad de México
  // Intl separa «p. m.» con espacios que no se cortan; aquí se comparan como espacios.
  const plain = (s: string) => s.replace(/[  ]/g, " ");

  test("de México: las dos horas, la suya marcada", () => {
    expect(slotLabel(iso, "America/Mexico_City", "America/Bogota")).toBe(dualZoneLabel(iso, "America/Mexico_City", "America/Bogota"));
    expect(plain(slotLabel(iso, "America/Mexico_City", "America/Bogota"))).toMatch(/2:00 p\. m\. \(tu hora\) · 3:00 p\. m\. en Colombia$/);
  });

  test("en Colombia: una sola", () => {
    expect(plain(slotLabel(iso, "America/Bogota", "America/Bogota"))).toBe("jueves, 22 de octubre, 3:00 p. m.");
  });

  test("sin saber su zona: la de Colombia, dicha (nunca como si fuera la suya)", () => {
    expect(plain(slotLabel(iso, null, "America/Bogota"))).toBe("jueves, 22 de octubre, 3:00 p. m. (hora de Colombia)");
  });
});
