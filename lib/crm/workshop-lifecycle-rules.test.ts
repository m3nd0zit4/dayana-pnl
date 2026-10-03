import { describe, expect, test } from "bun:test";

import {
  buildWorkshopTimeline,
  isWorkshopDatePast,
  isWorkshopEnded,
  isWorkshopPast,
  lifecycleStepFor,
  sortWorkshopsForList,
  workshopAcceptsReminders,
  workshopBlockersMessage,
  workshopCloseAt,
  workshopPublishBlockers,
  workshopStartsAtHasTime,
  workshopStatusAfterReopen,
  workshopStatusAfterUnpublish,
} from "./workshop-lifecycle-rules";

const TZ = "America/Bogota";
const H = 60 * 60 * 1000;
/** 2026-11-08 09:30 en Bogotá (UTC-5). */
const START = new Date("2026-11-08T14:30:00.000Z");

describe("estado", () => {
  test("terminado = endedAt o realizado", () => {
    expect(isWorkshopEnded({ status: "OPEN", endedAt: null })).toBe(false);
    expect(isWorkshopEnded({ status: "COMPLETED", endedAt: null })).toBe(true);
    expect(isWorkshopEnded({ status: "CLOSED", endedAt: new Date() })).toBe(true);
    expect(isWorkshopPast({ status: "DRAFT", endedAt: null })).toBe(false);
  });

  test("recordatorios: publicado o cerrado, sin terminar; nunca un borrador", () => {
    expect(workshopAcceptsReminders({ status: "OPEN", endedAt: null })).toBe(true);
    expect(workshopAcceptsReminders({ status: "CLOSED", endedAt: null })).toBe(true);
    expect(workshopAcceptsReminders({ status: "DRAFT", endedAt: null })).toBe(false);
    expect(workshopAcceptsReminders({ status: "CLOSED", endedAt: new Date() })).toBe(false);
    expect(workshopAcceptsReminders({ status: "COMPLETED", endedAt: null })).toBe(false);
  });

  test("cerrar inscripciones y reabrir", () => {
    expect(workshopStatusAfterUnpublish("OPEN")).toBe("CLOSED");
    expect(workshopStatusAfterUnpublish("DRAFT")).toBe("DRAFT");
    expect(workshopStatusAfterReopen("COMPLETED")).toBe("CLOSED");
    expect(workshopStatusAfterReopen("CLOSED")).toBe("CLOSED");
  });
});

describe("publicar", () => {
  /** Antes del taller: nada pasó todavía. */
  const BEFORE = new Date("2026-11-01T12:00:00.000Z");
  const ready = {
    title: "Sanando",
    cardSummary: "Una jornada en vivo.",
    startsAt: START,
    startsAtHasTime: true,
    timezone: TZ,
  };

  test("completo y con precio en pesos: nada que bloquee", () => {
    expect(workshopPublishBlockers(ready, true, BEFORE)).toEqual([]);
  });

  test("sin precio en pesos no se publica", () => {
    expect(workshopPublishBlockers(ready, false, BEFORE)).toEqual(["priceCop"]);
  });

  test("sin fecha, sin descripción o con la descripción igual al título", () => {
    expect(workshopPublishBlockers({ ...ready, startsAt: null }, true, BEFORE)).toEqual(["startsAt"]);
    expect(workshopPublishBlockers({ ...ready, cardSummary: null }, true, BEFORE)).toEqual(["description"]);
    expect(workshopPublishBlockers({ ...ready, cardSummary: "Sanando" }, true, BEFORE)).toEqual(["description"]);
    expect(
      workshopPublishBlockers({ ...ready, cardSummary: null, detailSummary: "Otra" }, true, BEFORE)
    ).toEqual([]);
  });

  test("con la fecha ya pasada no se publica (reabierto, por ejemplo)", () => {
    const after = new Date(START.getTime() + 4 * H);
    expect(isWorkshopDatePast(ready, after)).toBe(true);
    expect(workshopPublishBlockers(ready, true, after)).toEqual(["pastDate"]);
    expect(workshopBlockersMessage(["pastDate"])).toBe("La fecha ya pasó: cámbiala antes de publicar");
  });

  test("el mensaje nombra lo que falta", () => {
    expect(workshopBlockersMessage(["startsAt", "priceCop"])).toBe("Falta la fecha, el precio en pesos (COP)");
    expect(workshopBlockersMessage(["pastDate", "priceCop"])).toBe(
      "La fecha ya pasó: cámbiala antes de publicar. Falta el precio en pesos (COP)"
    );
  });
});

describe("cuándo termina", () => {
  const timed = { startsAt: START, startsAtHasTime: true, timezone: TZ };

  test("con hora: 3 h después de empezar", () => {
    expect(workshopCloseAt(timed)?.toISOString()).toBe(new Date(START.getTime() + 3 * H).toISOString());
  });

  test("nunca antes de que acabe el cronograma", () => {
    const daySchedule = [
      { startTime: "09:30", endTime: "12:00", title: "Mañana" },
      { startTime: "13:00", endTime: "16:30", title: "Tarde" },
    ];
    // 16:30 en Bogotá = 21:30 UTC.
    expect(workshopCloseAt({ ...timed, daySchedule })?.toISOString()).toBe("2026-11-08T21:30:00.000Z");
  });

  test("endsAt manda", () => {
    const endsAt = new Date("2026-11-08T23:00:00.000Z");
    expect(workshopCloseAt({ ...timed, endsAt })).toEqual(endsAt);
  });

  test("solo el día: 03:00 del día siguiente", () => {
    const noon = new Date("2026-11-08T17:00:00.000Z");
    const dateOnly = { startsAt: noon, startsAtHasTime: false, timezone: TZ };
    expect(workshopStartsAtHasTime(dateOnly)).toBe(false);
    expect(workshopCloseAt(dateOnly)?.toISOString()).toBe("2026-11-09T08:00:00.000Z");
  });

  test("un taller a mediodía conserva su hora: no se deduce de las 12:00", () => {
    const noon = new Date("2026-11-08T17:00:00.000Z");
    const atNoon = { startsAt: noon, startsAtHasTime: true, timezone: TZ };
    expect(workshopStartsAtHasTime(atNoon)).toBe(true);
    expect(workshopCloseAt(atNoon)?.toISOString()).toBe("2026-11-08T20:00:00.000Z");
  });

  test("sin fecha no se cierra solo", () => {
    expect(workshopCloseAt({ startsAt: null, startsAtHasTime: false, timezone: TZ })).toBeNull();
    expect(workshopStartsAtHasTime({ startsAt: null, startsAtHasTime: true })).toBe(false);
  });
});

describe("la lista", () => {
  const row = (id: string, status: "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED", startsAt: Date | null) => ({
    id,
    status,
    startsAt,
    endedAt: status === "COMPLETED" ? new Date() : null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });

  test("publicado, cerrados, borradores (el más próximo primero) y realizados (el más reciente primero)", () => {
    const sorted = sortWorkshopsForList([
      row("viejo", "COMPLETED", new Date("2026-05-16T12:30:00Z")),
      row("borrador-sin-fecha", "DRAFT", null),
      row("borrador-dic", "DRAFT", new Date("2026-12-01T12:00:00Z")),
      row("abierto", "OPEN", new Date("2026-11-08T14:30:00Z")),
      row("reciente", "COMPLETED", new Date("2026-09-01T12:30:00Z")),
      row("cerrado", "CLOSED", new Date("2026-10-20T12:30:00Z")),
      row("borrador-nov", "DRAFT", new Date("2026-11-20T12:00:00Z")),
    ]);
    expect(sorted.map((r) => r.id)).toEqual([
      "abierto",
      "cerrado",
      "borrador-nov",
      "borrador-dic",
      "borrador-sin-fecha",
      "reciente",
      "viejo",
    ]);
  });
});

describe("compatibilidad: el asistente pide un estado", () => {
  const at = (status: "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED", ended = false) => ({
    status,
    endedAt: ended || status === "COMPLETED" ? new Date() : null,
  });

  test("abrir", () => {
    expect(lifecycleStepFor(at("DRAFT"), "OPEN")).toBe("publish");
    expect(lifecycleStepFor(at("CLOSED"), "OPEN")).toBe("publish");
    expect(lifecycleStepFor(at("OPEN"), "OPEN")).toBeNull();
    expect(lifecycleStepFor(at("COMPLETED"), "OPEN")).toBe("reopen_publish");
  });

  test("cerrar", () => {
    expect(lifecycleStepFor(at("OPEN"), "CLOSED")).toBe("unpublish");
    expect(lifecycleStepFor(at("DRAFT"), "CLOSED")).toBe("close_draft");
    expect(lifecycleStepFor(at("COMPLETED"), "CLOSED")).toBe("reopen");
    expect(lifecycleStepFor(at("CLOSED"), "CLOSED")).toBeNull();
  });

  test("terminar y volver a borrador", () => {
    expect(lifecycleStepFor(at("OPEN"), "COMPLETED")).toBe("end");
    expect(lifecycleStepFor(at("COMPLETED"), "COMPLETED")).toBeNull();
    expect(lifecycleStepFor(at("CLOSED"), "DRAFT")).toBe("to_draft");
    expect(lifecycleStepFor(at("DRAFT"), "DRAFT")).toBeNull();
  });
});

describe("historia", () => {
  const act = (id: string, kind: string, at: string, extra: Record<string, unknown> = {}) => ({
    id,
    kind,
    at: new Date(at),
    count: null,
    failed: null,
    staffUserId: null,
    whatsAppSendId: null,
    meta: null,
    ...extra,
  });

  test("títulos de taller, detalle del precio y de la copia, de la más reciente a la más antigua", () => {
    const items = buildWorkshopTimeline({
      activities: [
        act("1", "created", "2026-10-01T10:00:00Z", { meta: { copiedFromTitle: "Sanando I" } }),
        act("2", "price_changed", "2026-10-01T11:00:00Z", { meta: { cop: 180000, usd: 4500 } }),
        act("3", "published", "2026-10-01T12:00:00Z"),
        act("4", "closed", "2026-10-02T12:00:00Z", { meta: { byTitle: "Sanando II" } }),
        act("5", "ended", "2026-10-09T12:00:00Z", { meta: { by: "cron" } }),
      ],
      sends: [],
    });
    expect(items.map((i) => i.title)).toEqual([
      "Taller terminado",
      "Inscripciones cerradas: se publicó otro taller",
      "Publicado",
      "Precio cambiado",
      "Taller creado",
    ]);
    expect(items[0].detail).toBe("Lo cerró el reloj al pasar la fecha");
    expect(items[1].detail).toBe("Se publicó «Sanando II»");
    expect(items[3].detail).toBe("$ 180.000 COP · US$45.00");
    expect(items[4].detail).toBe("Con la página de «Sanando I»");
  });

  test("las pasadas seguidas del reloj se juntan, y los envíos de WhatsApp salen con sus números", () => {
    const items = buildWorkshopTimeline({
      activities: [
        act("a", "reminder_24h_wa", "2026-10-07T10:00:00Z", { count: 3 }),
        act("b", "reminder_24h_wa", "2026-10-07T10:10:00Z", { count: 2, failed: 1 }),
      ],
      sends: [
        {
          id: "s1",
          title: "Taller: Sanando · Invitación",
          status: "DONE",
          total: 10,
          sent: 9,
          failed: 1,
          skipped: 0,
          createdAt: new Date("2026-10-05T10:00:00Z"),
          finishedAt: new Date("2026-10-05T10:05:00Z"),
        },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Recordatorio de 24 h por WhatsApp");
    expect(items[0].count).toBe(5);
    expect(items[0].failed).toBe(1);
    expect(items[0].runs).toBe(2);
    expect(items[1].title).toBe("WhatsApp: Invitación");
    expect(items[1].sendId).toBe("s1");
  });
});
