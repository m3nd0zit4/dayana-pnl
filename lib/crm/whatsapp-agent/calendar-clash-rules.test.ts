import { describe, expect, test } from "bun:test";

import { clashNotice, clashStep, findClash } from "./calendar-clash-rules";

const t = (iso: string) => new Date(iso).getTime();
// Estefania: llamada mié 21-oct 10:30–10:45 (Bogotá); «live» 10:15–12:15 puesto después.
const call = { eventId: "estefania", start: t("2026-10-21T15:30:00Z"), end: t("2026-10-21T15:45:00Z") };
const live = { eventId: "live", title: "live", start: t("2026-10-21T15:15:00Z"), end: t("2026-10-21T17:15:00Z") };

describe("findClash", () => {
  test("un evento encima de la llamada choca", () => {
    expect(findClash(call, [live])?.eventId).toBe("live");
  });

  test("la propia cita y lo que solo toca el borde no chocan", () => {
    expect(findClash(call, [{ ...call, title: "0/0 Estefania" }])).toBeNull();
    // Alexandra 10:00–10:15 termina justo cuando empieza el live: no choca.
    const alexandra = { eventId: "alexandra", start: t("2026-10-21T15:00:00Z"), end: t("2026-10-21T15:15:00Z") };
    expect(findClash(alexandra, [live])).toBeNull();
    expect(findClash(call, [{ eventId: "otra", title: "otra", start: call.end, end: call.end + 15 * 60_000 }])).toBeNull();
  });

  test("con varios, el que empieza primero", () => {
    const early = { eventId: "early", title: "videos", start: call.start - 60 * 60_000, end: call.start + 5 * 60_000 };
    expect(findClash(call, [live, early])?.eventId).toBe("early");
  });
});

describe("clashStep", () => {
  test("choque nuevo: se avisa; el mismo otra vez: no", () => {
    expect(clashStep({ clash: live, notifiedEventId: null }).kind).toBe("notify");
    expect(clashStep({ clash: live, notifiedEventId: "live" }).kind).toBe("keep");
  });

  test("choca con otro evento después: se avisa de nuevo", () => {
    expect(clashStep({ clash: live, notifiedEventId: "videos" }).kind).toBe("notify");
  });

  test("Dayana lo arregló: se borra sin aviso", () => {
    expect(clashStep({ clash: null, notifiedEventId: "live" }).kind).toBe("clear");
    expect(clashStep({ clash: null, notifiedEventId: null }).kind).toBe("none");
  });
});

describe("clashNotice", () => {
  test("quién, cuándo y con qué, con a. m./p. m. en la zona de Dayana", () => {
    const n = clashNotice({
      name: "Estefania Blandon ibarra",
      callStart: new Date(call.start),
      clash: { title: "live", start: new Date(live.start), end: new Date(live.end) },
      timeZone: "America/Bogota",
    });
    expect(n.title).toBe("Choque en tu agenda: llamada gratis de Estefania");
    expect(n.body).toContain("miércoles, 21 de octubre, 10:30 a. m.");
    expect(n.body).toContain("«live» (10:15 a. m.–12:15 p. m.)");
  });

  test("sin un nombre de persona", () => {
    const n = clashNotice({ name: "☺️", callStart: new Date(call.start), clash: { title: "", start: new Date(live.start), end: new Date(live.end) }, timeZone: "America/Bogota" });
    expect(n.title).toBe("Choque en tu agenda: llamada gratis de una persona");
    expect(n.body).toContain("«otro evento»");
  });
});
