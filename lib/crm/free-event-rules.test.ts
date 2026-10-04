import { describe, expect, test } from "bun:test";

import {
  EVENT_CONFIRMATION_CAP,
  FREE_EVENT_ALIAS_SLUG,
  buildFreeEventTimeline,
  confirmationCapReason,
  endedEventAgentMessage,
  freeEventAcceptsReminders,
  isFreeEventEnded,
  freeEventPublicPath,
  freeEventSlugBase,
  freeEventSlugCandidates,
  inscritasBulkLabel,
  isActiveFor,
  isFreeEventOpenRow,
  isReservedFreeEventSlug,
  pickCurrentFreeEvent,
  registrationsPerDay,
  resolveRegistrationTarget,
  sendLabel,
  statusAfterReopen,
  statusAfterUnpublish,
  summarizeFlag,
  type ActivityLike,
  type CurrentCandidate,
  type SendLike,
} from "./free-event-rules";

describe("URL de un evento", () => {
  test("titular sin tildes + fecha", () => {
    expect(freeEventSlugBase("Reprograma tu mente con PNL", "2026-11-08")).toBe(
      "reprograma-tu-mente-con-pnl-2026-11-08"
    );
    expect(freeEventSlugBase("¡Sanar la relación con mamá!", "2026-10-04")).toBe(
      "sanar-la-relacion-con-mama-2026-10-04"
    );
  });

  test("un titular largo se corta en una palabra y la fecha queda entera", () => {
    const slug = freeEventSlugBase(
      "Reprograma tu mente con PNL — webinar gratuito en vivo con Dayana",
      "2026-10-04"
    );
    expect(slug).toBe("reprograma-tu-mente-con-pnl-webinar-2026-10-04");
    expect(slug.endsWith("2026-10-04")).toBe(true);
  });

  test("sin fecha o sin titular útil", () => {
    expect(freeEventSlugBase("Masterclass", null)).toBe("masterclass");
    expect(freeEventSlugBase("   ", "2026-10-04")).toBe("2026-10-04");
    expect(freeEventSlugBase("", null)).toBe("evento");
  });

  test("candidatas: la base, luego -2, -3…", () => {
    const it = freeEventSlugCandidates("masterclass-2026-10-04");
    expect(it.next().value).toBe("masterclass-2026-10-04");
    expect(it.next().value).toBe("masterclass-2026-10-04-2");
    expect(it.next().value).toBe("masterclass-2026-10-04-3");
  });

  test("«gratuito» es el alias del evento actual: nunca la URL de un evento", () => {
    expect(isReservedFreeEventSlug(FREE_EVENT_ALIAS_SLUG)).toBe(true);
    expect(isReservedFreeEventSlug("gratuito-2")).toBe(false);
    expect(freeEventPublicPath({ id: "abc", slug: "gratuito" })).toBe("/eventos-gratuitos/abc");
    expect(freeEventPublicPath({ id: "abc", slug: "masterclass-2026-10-04" })).toBe(
      "/eventos-gratuitos/masterclass-2026-10-04"
    );
  });
});

describe("estado", () => {
  const base = { status: "OPEN" as const, isActive: true, startsAt: new Date("2026-10-04T14:30:00Z"), endedAt: null as Date | null };

  test("isActive es el espejo de OPEN", () => {
    expect(isActiveFor("OPEN")).toBe(true);
    expect(isActiveFor("DRAFT")).toBe(false);
    expect(isActiveFor("CLOSED")).toBe(false);
    expect(isActiveFor("COMPLETED")).toBe(false);
  });

  test("apagar la página cierra inscripciones; reabrir uno terminado no lo publica", () => {
    expect(statusAfterUnpublish("OPEN")).toBe("CLOSED");
    expect(statusAfterUnpublish("DRAFT")).toBe("DRAFT");
    expect(statusAfterReopen("COMPLETED")).toBe("CLOSED");
    expect(statusAfterReopen("CLOSED")).toBe("CLOSED");
  });

  test("abierto a inscripciones: publicado, con fecha y sin terminar", () => {
    expect(isFreeEventOpenRow(base)).toBe(true);
    expect(isFreeEventOpenRow({ ...base, startsAt: null })).toBe(false);
    expect(isFreeEventOpenRow({ ...base, endedAt: new Date() })).toBe(false);
    expect(isFreeEventOpenRow({ ...base, status: "CLOSED", isActive: false })).toBe(false);
  });

  test("recordatorios: publicado o cerrado sin terminar (y filas viejas con isActive)", () => {
    expect(freeEventAcceptsReminders(base)).toBe(true);
    expect(freeEventAcceptsReminders({ ...base, status: "CLOSED", isActive: false })).toBe(true);
    expect(freeEventAcceptsReminders({ ...base, status: "DRAFT", isActive: true })).toBe(true);
    expect(freeEventAcceptsReminders({ ...base, status: "DRAFT", isActive: false })).toBe(false);
    expect(freeEventAcceptsReminders({ ...base, endedAt: new Date() })).toBe(false);
  });
});

describe("el evento actual", () => {
  const d = (s: string) => new Date(s);
  const row = (over: Partial<CurrentCandidate> & { id: string }): CurrentCandidate => ({
    slug: over.id,
    status: "DRAFT",
    startsAt: null,
    endedAt: null,
    publishedAt: null,
    createdAt: d("2026-09-01T00:00:00Z"),
    ...over,
  });

  test("sin eventos, ninguno", () => {
    expect(pickCurrentFreeEvent([])).toBeNull();
  });

  test("el publicado gana a todo", () => {
    const rows = [
      row({ id: "draft", createdAt: d("2026-10-02T00:00:00Z") }),
      row({ id: "open", status: "OPEN", startsAt: d("2026-11-08T14:00:00Z"), publishedAt: d("2026-10-01T00:00:00Z") }),
      row({ id: "closed", status: "CLOSED", startsAt: d("2026-10-04T14:00:00Z") }),
    ];
    expect(pickCurrentFreeEvent(rows)?.id).toBe("open");
  });

  test("si hubiera dos publicados, el de fecha más tardía", () => {
    const rows = [
      row({ id: "a", status: "OPEN", startsAt: d("2026-10-04T14:00:00Z") }),
      row({ id: "b", status: "OPEN", startsAt: d("2026-11-08T14:00:00Z") }),
    ];
    expect(pickCurrentFreeEvent(rows)?.id).toBe("b");
  });

  test("sin publicado: el cerrado que aún no pasa, luego el borrador más reciente", () => {
    const closed = row({ id: "closed", status: "CLOSED", startsAt: d("2026-10-04T14:00:00Z") });
    const drafts = [
      row({ id: "old-draft", createdAt: d("2026-09-01T00:00:00Z") }),
      row({ id: "new-draft", createdAt: d("2026-09-20T00:00:00Z") }),
    ];
    expect(pickCurrentFreeEvent([...drafts, closed])?.id).toBe("closed");
    expect(pickCurrentFreeEvent(drafts)?.id).toBe("new-draft");
  });

  test("un borrador nuevo gana al último realizado (el que se prepara)", () => {
    const done = row({ id: "done", status: "COMPLETED", startsAt: d("2026-10-04T14:00:00Z"), endedAt: d("2026-10-04T17:30:00Z") });
    const draft = row({ id: "draft" });
    expect(pickCurrentFreeEvent([done, draft])?.id).toBe("draft");
  });

  test("solo realizados: el último; un terminado cuenta como realizado aunque diga OPEN", () => {
    const rows = [
      row({ id: "aug", status: "COMPLETED", startsAt: d("2026-08-16T14:30:00Z"), endedAt: d("2026-08-16T17:30:00Z") }),
      row({ id: "oct", status: "OPEN", startsAt: d("2026-10-04T14:30:00Z"), endedAt: d("2026-10-04T17:30:00Z") }),
    ];
    expect(pickCurrentFreeEvent(rows)?.id).toBe("oct");
    expect(pickCurrentFreeEvent([rows[0], row({ id: "x", status: "CLOSED" })])?.id).toBe("x");
  });

  test("a igualdad, la fila heredada «gratuito»", () => {
    const at = d("2026-10-04T14:30:00Z");
    const rows = [
      row({ id: "copy", status: "COMPLETED", startsAt: at, endedAt: at }),
      row({ id: "legacy", slug: "gratuito", status: "COMPLETED", startsAt: at, endedAt: at }),
    ];
    expect(pickCurrentFreeEvent(rows)?.id).toBe("legacy");
  });
});

describe("a qué evento va una inscripción", () => {
  type Row = {
    id: string;
    status: "OPEN" | "CLOSED";
    isActive: boolean;
    startsAt: Date | null;
    endedAt: Date | null;
  };
  const open: Row = { id: "B", status: "OPEN", isActive: true, startsAt: new Date("2026-11-08T14:00:00Z"), endedAt: null };
  const closed: Row = { ...open, id: "A", status: "CLOSED", isActive: false };

  test("al pedido si sigue abierto", () => {
    expect(resolveRegistrationTarget(open, open)?.id).toBe("B");
  });

  test("un formulario viejo de un evento cerrado va al abierto", () => {
    expect(resolveRegistrationTarget(closed, open)?.id).toBe("B");
    expect(resolveRegistrationTarget(null, open)?.id).toBe("B");
  });

  test("sin evento abierto, a ninguno", () => {
    expect(resolveRegistrationTarget(closed, null)).toBeNull();
    expect(resolveRegistrationTarget(null, { ...open, endedAt: new Date() })).toBeNull();
  });
});

describe("historia", () => {
  const at = (s: string) => new Date(`2026-10-0${s}Z`);
  const act = (id: string, kind: string, when: string, extra: Partial<ActivityLike> = {}): ActivityLike => ({
    id,
    kind,
    at: at(when),
    count: null,
    failed: null,
    staffUserId: null,
    whatsAppSendId: null,
    meta: null,
    ...extra,
  });
  const send = (id: string, when: string, extra: Partial<SendLike> = {}): SendLike => ({
    id,
    title: "Evento: Reprograma · Recordatorio con el enlace de Meet",
    status: "DONE",
    total: 10,
    sent: 8,
    failed: 1,
    skipped: 1,
    createdAt: at(when),
    finishedAt: at(when),
    ...extra,
  });

  test("ordena de la más reciente a la más antigua y nombra cada paso", () => {
    const items = buildFreeEventTimeline({
      activities: [act("1", "created", "1T10:00:00"), act("2", "published", "1T11:00:00"), act("3", "ended", "4T17:30:00", { meta: { by: "cron" } })],
      sends: [],
    });
    expect(items.map((i) => i.kind)).toEqual(["ended", "published", "created"]);
    expect(items[0].title).toBe("Evento terminado");
    expect(items[0].detail).toContain("reloj");
  });

  test("un envío registrado como actividad sale una vez, con los números del envío", () => {
    const items = buildFreeEventTimeline({
      activities: [act("a", "whatsapp_bulk", "2T09:00:00", { count: 10, whatsAppSendId: "s1" })],
      sends: [send("s1", "2T09:00:00")],
    });
    expect(items).toHaveLength(1);
    expect(items[0].sendId).toBe("s1");
    expect(items[0].count).toBe(8);
    expect(items[0].failed).toBe(1);
    expect(items[0].title).toBe("WhatsApp: Recordatorio con el enlace de Meet");
    expect(items[0].tone).toBe("warning");
  });

  test("material enviado: conserva su tipo aunque lo pinte el envío", () => {
    const items = buildFreeEventTimeline({
      activities: [act("a", "material_sent", "5T09:00:00", { whatsAppSendId: "s2" })],
      sends: [send("s2", "5T09:00:00", { title: "Evento: X · Material o grabación", failed: 0 })],
    });
    expect(items[0].kind).toBe("material_sent");
    expect(items[0].title).toBe("WhatsApp: Material o grabación");
  });

  test("las pasadas seguidas del reloj se juntan con su total", () => {
    const items = buildFreeEventTimeline({
      activities: [
        act("1", "reminder_24h_email", "3T14:33:00", { count: 120 }),
        act("2", "reminder_24h_email", "3T14:43:00", { count: 2, failed: 1 }),
        act("3", "reminder_24h_email", "3T18:03:00", { count: 1 }),
        act("4", "reminder_1h_email", "4T13:33:00", { count: 118 }),
        act("5", "reminder_24h_email", "4T13:43:00", { count: 1 }),
      ],
      sends: [],
    });
    expect(items).toHaveLength(3);
    const first24 = items[2];
    expect(first24.kind).toBe("reminder_24h_email");
    expect(first24.count).toBe(123);
    expect(first24.failed).toBe(1);
    expect(first24.runs).toBe(3);
    expect(first24.until?.toISOString()).toBe("2026-10-03T18:03:00.000Z");
    // Una pasada suelta después del 1 h no se junta con las de antes.
    expect(items[0].runs).toBe(1);
  });

  test("lo que no se pasa: «created», «published»… nunca se juntan", () => {
    const items = buildFreeEventTimeline({
      activities: [act("1", "date_changed", "1T10:00:00"), act("2", "date_changed", "1T10:05:00")],
      sends: [],
    });
    expect(items).toHaveLength(2);
  });

  test("etiqueta corta de un envío", () => {
    expect(sendLabel("Evento: Reprograma · Invitación")).toBe("Invitación");
    expect(sendLabel("Envío suelto")).toBe("Envío suelto");
  });
});

describe("inscripciones por día y sellos", () => {
  test("cuenta por día en la zona del CRM y rellena los días vacíos", () => {
    const days = registrationsPerDay(
      [
        new Date("2026-10-01T15:00:00Z"),
        new Date("2026-10-01T23:00:00Z"),
        // 2 de octubre 01:00 UTC = 1 de octubre en Bogotá
        new Date("2026-10-02T01:00:00Z"),
        new Date("2026-10-03T15:00:00Z"),
      ],
      "America/Bogota"
    );
    expect(days).toEqual([
      { day: "2026-10-01", count: 3 },
      { day: "2026-10-02", count: 0 },
      { day: "2026-10-03", count: 1 },
    ]);
    expect(registrationsPerDay([], "America/Bogota")).toEqual([]);
  });

  test("como mucho los últimos N días", () => {
    const dates = Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i, 15)));
    expect(registrationsPerDay(dates, "America/Bogota", 4)).toHaveLength(4);
  });

  test("un sello: cuántas y entre qué fechas", () => {
    const s = summarizeFlag([
      null,
      new Date("2026-10-03T14:40:00Z"),
      undefined,
      new Date("2026-10-03T14:33:00Z"),
      new Date("2026-10-04T13:33:00Z"),
    ]);
    expect(s.count).toBe(3);
    expect(s.first?.toISOString()).toBe("2026-10-03T14:33:00.000Z");
    expect(s.last?.toISOString()).toBe("2026-10-04T13:33:00.000Z");
    expect(summarizeFlag([])).toEqual({ count: 0, first: null, last: null });
  });
});

describe("un evento que ya pasó", () => {
  test("terminado o realizado: ya pasó", () => {
    expect(isFreeEventEnded({ status: "COMPLETED", endedAt: null })).toBe(true);
    expect(isFreeEventEnded({ status: "OPEN", endedAt: new Date() })).toBe(true);
    expect(isFreeEventEnded({ status: "CLOSED", endedAt: null })).toBe(false);
    expect(isFreeEventEnded({ status: "DRAFT", endedAt: null })).toBe(false);
  });

  test("realizado sin fecha de cierre (base vieja): sin recordatorios", () => {
    expect(
      freeEventAcceptsReminders({ status: "COMPLETED", isActive: true, startsAt: new Date(), endedAt: null })
    ).toBe(false);
  });

  test("el agente lo dice y manda a crear el siguiente", () => {
    const msg = endedEventAgentMessage("Reprograma tu mente");
    expect(msg).toContain("«Reprograma tu mente»");
    expect(msg).toContain("Nuevo evento");
    expect(msg).toContain("Duplicar");
  });
});

describe("tope de confirmaciones por WhatsApp", () => {
  test("por debajo de los dos topes, sale", () => {
    expect(confirmationCapReason({ lastHour: 0, lastDay: 0 })).toBeNull();
    expect(
      confirmationCapReason({ lastHour: EVENT_CONFIRMATION_CAP.perHour - 1, lastDay: EVENT_CONFIRMATION_CAP.perDay - 1 })
    ).toBeNull();
  });

  test("en el tope de la hora o del día, no sale", () => {
    expect(confirmationCapReason({ lastHour: EVENT_CONFIRMATION_CAP.perHour, lastDay: 10 })).toBe("hour");
    expect(confirmationCapReason({ lastHour: 3, lastDay: EVENT_CONFIRMATION_CAP.perDay })).toBe("day");
    expect(confirmationCapReason({ lastHour: 500, lastDay: 500 })).toBe("hour");
  });

  test("con un tope propio", () => {
    expect(confirmationCapReason({ lastHour: 2, lastDay: 2 }, { perHour: 2, perDay: 10 })).toBe("hour");
    expect(confirmationCapReason({ lastHour: 1, lastDay: 1 }, { perHour: 2, perDay: 10 })).toBeNull();
  });

  test("los topes por defecto: 40 por hora y 300 por día", () => {
    expect(EVENT_CONFIRMATION_CAP).toEqual({ perHour: 40, perDay: 300 });
  });
});

describe("inscritasBulkLabel", () => {
  test("con «Todos» dice que son todos los eventos", () => {
    expect(inscritasBulkLabel({ eventSelected: false, searching: false })).toBe(
      "Enviar a todas (todos los eventos)"
    );
  });

  test("con un evento elegido, las del evento", () => {
    expect(inscritasBulkLabel({ eventSelected: true, searching: false })).toBe("Enviar a todas las del evento");
  });

  test("con búsqueda, las de la búsqueda (y si es sobre todos, lo dice)", () => {
    expect(inscritasBulkLabel({ eventSelected: true, searching: true })).toBe("Enviar a las de la búsqueda");
    expect(inscritasBulkLabel({ eventSelected: false, searching: true })).toBe(
      "Enviar a las de la búsqueda (todos los eventos)"
    );
  });
});
