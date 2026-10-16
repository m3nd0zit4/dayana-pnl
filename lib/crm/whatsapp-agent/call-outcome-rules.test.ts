import { describe, expect, test } from "bun:test";

import {
  callWhenLabel,
  canChangeOutcome,
  CHECK_MAX_AGE_HOURS,
  checkMessage,
  checkReply,
  followUpStep,
  needsOutcomeMark,
  outcomeFromChat,
  planManualMark,
  planOutcomeChange,
  RESCHEDULE_FROM_CHAT_MAX_AGE_HOURS,
  rescheduleMessage,
  rescheduleSendOf,
  type OutcomeMessage,
} from "./call-outcome-rules";

const start = new Date("2026-10-20T15:00:00Z");
const at = (min: number) => new Date(start.getTime() + min * 60_000);
const inb = (body: string, min = 20): OutcomeMessage => ({ direction: "INBOUND", body, sentAt: at(min) });
const dayana = (body: string, min = 20, extra: Partial<OutcomeMessage> = {}): OutcomeMessage => ({ direction: "OUTBOUND", body, sentAt: at(min), ...extra });

describe("outcomeFromChat", () => {
  test("ella escribe que no la llamaron: no contestada", () => {
    expect(outcomeFromChat([inb("Hola, no me llamaron, sigo esperando")], { startsAt: start })?.outcome).toBe("no_answer");
  });

  test("Dayana escribe que no contestó: no contestada", () => {
    expect(outcomeFromChat([dayana("Hola Lucía, te llamé y no contestas")], { startsAt: start })?.outcome).toBe("no_answer");
  });

  test("Dayana manda los paquetes después de hablar: contestada", () => {
    expect(outcomeFromChat([dayana("Fue un gusto hablar contigo, te comparto los paquetes")], { startsAt: start })?.outcome).toBe("answered");
  });

  test("ella agradece la llamada: contestada", () => {
    expect(outcomeFromChat([inb("Gracias por la llamada, me encantó")], { startsAt: start })?.outcome).toBe("answered");
  });

  test("pagó después: contestada", () => {
    expect(outcomeFromChat([], { startsAt: start, paidAfter: true })?.outcome).toBe("answered");
  });

  test("sin señales o con señales de las dos: no se decide (se pregunta)", () => {
    expect(outcomeFromChat([inb("Ok, gracias")], { startsAt: start })).toBeNull();
    expect(outcomeFromChat([inb("Gracias por la llamada"), dayana("Te llamé y no contestas")], { startsAt: start })).toBeNull();
  });

  test("lo automático (la IA, recordatorios) no cuenta como Dayana", () => {
    expect(outcomeFromChat([dayana("Fue un gusto hablar contigo", 20, { isAutoReply: true })], { startsAt: start })).toBeNull();
    expect(outcomeFromChat([dayana("No logramos comunicarnos", 20, { source: "recordatorio:x" })], { startsAt: start })).toBeNull();
  });

  test("lo de mucho antes de la llamada no cuenta", () => {
    expect(outcomeFromChat([inb("Sigo esperando tu respuesta", -120)], { startsAt: start })).toBeNull();
  });
});

describe("checkReply", () => {
  test("sí", () => {
    expect(checkReply("Sí, gracias!")).toBe("answered");
    expect(checkReply("si pude, me encantó")).toBe("answered");
    expect(checkReply("Claro")).toBe("answered");
  });

  test("no", () => {
    expect(checkReply("No")).toBe("no_answer");
    expect(checkReply("No me llamó")).toBe("no_answer");
    expect(checkReply("todavía no")).toBe("no_answer");
    expect(checkReply("se me pasó, perdón")).toBe("no_answer");
  });

  test("lo que no se entiende queda sin decidir", () => {
    expect(checkReply("¿Cuánto cuesta el paquete?")).toBeNull();
  });
});

describe("rescheduleMessage", () => {
  test("con horas, en viñetas", () => {
    const text = rescheduleMessage("Lucía Pérez", ["jueves 16 de octubre, 3:00 p. m. (tu hora)", "viernes 17 de octubre, 10:00 a. m. (tu hora)"]);
    expect(text).toContain("Hola Lucía 🙏 Dayana te llamó a la hora de tu llamada gratis y no lograron comunicarse.");
    expect(text).toContain("• jueves 16 de octubre, 3:00 p. m.");
    expect(text).toContain("¿Cuál te queda mejor?");
  });

  test("sin horas libres, le pide un día", () => {
    expect(rescheduleMessage(null, [])).toContain("qué día y hora te quedan bien");
  });

  test("sin un nombre que sea de persona, solo «Hola»", () => {
    expect(rescheduleMessage("DIOS ES MI PROVEEDOR 🙏", [])).toStartWith("Hola 🙏 Dayana te llamó");
    expect(checkMessage(null)).toBe("Hola 🙏 ¿Pudiste hablar con Dayana en tu llamada gratis?");
  });

  // Voz de la asistente, tono serio, sin suponer género (reglas de la dueña).
  const texts = [
    rescheduleMessage("Lucía", ["jueves 16 de octubre, 3:00 p. m. (tu hora) · 4:00 p. m. en Colombia"]),
    rescheduleMessage("Lucía", []),
    checkMessage("Lucía"),
  ];
  test("sin corazones ni apodos", () => {
    for (const t of texts) {
      expect(t).not.toMatch(/[💛❤️💕💖💗💓💞💘💝🥰😘😍♥🫶]/u);
      expect(t).not.toMatch(/\b(querid[oa]|cariño|mi amor|hermos[oa]|bell[oa]|lind[oa]|mi reina|corazón|amig[oa])\b/i);
    }
  });
  test("Dayana en tercera persona (la asistente no es ella)", () => {
    for (const t of texts) expect(t).not.toMatch(/\b(te llamo|te llamé|soy dayana|mi consulta|quedamos agendad)/i);
  });
  test("sin género: ni «atentos/atentas», ni «lista», ni «bienvenida»", () => {
    for (const t of texts) expect(t).not.toMatch(/\b(atent|list|bienvenid|tranquil|segur|interesad)[oa]s?\b/i);
  });
  test("las horas con a. m./p. m., nunca 15:00", () => {
    for (const t of texts) expect(t).not.toMatch(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b(?!\s*(?:a|p)\.?\s*m)/i);
  });
});

const H = 3600_000;
const ended = new Date("2026-10-16T00:15:00Z"); // 7:15 p. m. en Bogotá
const after = (h: number) => new Date(ended.getTime() + h * H);
const step = (over: Partial<Parameters<typeof followUpStep>[0]> = {}) =>
  followUpStep({ endsAt: ended, now: after(1), fromChat: null, checkSentAt: null, blocked: false, assumeMissedAfterHours: 24, ...over });
const missed = { outcome: "no_answer" as const, reason: "Ella escribió que no recibió la llamada o no pudo contestar." };

describe("followUpStep: la primera vez que corre el reloj no escribe a chats viejos", () => {
  test("terminó hace menos de 6 h y el chat no dice nada: se pregunta", () => {
    expect(step({ now: after(0.2) }).kind).toBe("ask");
    expect(step({ now: after(CHECK_MAX_AGE_HOURS - 0.1) }).kind).toBe("ask");
  });

  test("terminó hace 6 h o más y el chat no dice nada: no se le escribe (queda para Dayana)", () => {
    expect(step({ now: after(CHECK_MAX_AGE_HOURS) }).kind).toBe("too_old");
    expect(step({ now: after(4 * 24) }).kind).toBe("too_old");
  });

  test("el chat sí puede decidir las viejas", () => {
    const yes = step({ now: after(3 * 24), fromChat: { outcome: "answered", reason: "Ella agradeció la llamada." } });
    expect(yes).toEqual({ kind: "settle", outcome: "answered", source: "chat", reason: "Ella agradeció la llamada.", reschedule: false });
  });

  test("«no me llamaron»: horas para reagendar solo si terminó hace menos de 24 h", () => {
    expect(step({ now: after(8), fromChat: missed })).toMatchObject({ kind: "settle", outcome: "no_answer", reschedule: true });
    expect(step({ now: after(RESCHEDULE_FROM_CHAT_MAX_AGE_HOURS - 0.1), fromChat: missed })).toMatchObject({ reschedule: true });
    expect(step({ now: after(RESCHEDULE_FROM_CHAT_MAX_AGE_HOURS), fromChat: missed })).toMatchObject({ kind: "settle", outcome: "no_answer", reschedule: false });
    expect(step({ now: after(3 * 24), fromChat: missed })).toMatchObject({ reschedule: false });
  });

  test("en un chat en silencio se decide, pero no se escribe", () => {
    expect(step({ now: after(1), fromChat: missed, blocked: true })).toMatchObject({ kind: "settle", reschedule: false });
    expect(step({ now: after(1), blocked: true }).kind).toBe("silenced");
  });

  test("ya se le preguntó: se espera; sin respuesta en 24 h, no contestó (y se le mandan horas)", () => {
    const asked = after(0.2);
    expect(step({ now: after(10), checkSentAt: asked }).kind).toBe("wait");
    expect(step({ now: new Date(asked.getTime() + 24 * H), checkSentAt: asked })).toEqual({
      kind: "settle",
      outcome: "no_answer",
      source: "timeout",
      reason: "Sin respuesta en 24 h.",
      reschedule: true,
    });
  });
});

describe("Dayana lo marca con un toque", () => {
  const start = new Date("2026-10-16T00:15:00Z");
  const now = new Date(start.getTime() + 20 * 60_000);
  const base = { callOutcome: null, startsAt: start, now, blocked: false };

  test("«Hablaron»: queda decidida, sin mensaje", () => {
    expect(planManualMark({ ...base, outcome: "answered" })).toEqual({
      kind: "settle",
      outcome: "answered",
      reason: "Dayana marcó en el CRM que hablaron.",
      send: "none",
    });
  });

  test("«No contestó»: se le mandan horas, salvo chat en silencio", () => {
    expect(planManualMark({ ...base, outcome: "no_answer" })).toMatchObject({ kind: "settle", outcome: "no_answer", send: "reschedule" });
    expect(planManualMark({ ...base, outcome: "no_answer", blocked: true })).toMatchObject({ kind: "settle", send: "silenced" });
  });

  test("«No contestó · sin mensaje»: ya le escribió ella, no sale nada", () => {
    expect(planManualMark({ ...base, outcome: "no_answer", sendHours: false })).toMatchObject({ kind: "settle", outcome: "no_answer", send: "none" });
  });

  test("ya decidida (por el chat, la respuesta, el tiempo o ella): no se cambia", () => {
    for (const callOutcome of ["answered", "no_answer", "rescheduled", "not_free"]) {
      expect(planManualMark({ ...base, callOutcome, outcome: "no_answer" })).toEqual({ kind: "already_decided" });
    }
  });

  test("antes de la hora no se marca", () => {
    expect(planManualMark({ ...base, now: new Date(start.getTime() - 60_000), outcome: "answered" })).toEqual({ kind: "not_yet" });
  });

  test("qué pasó con el mensaje, en lo que la pantalla explica", () => {
    expect(rescheduleSendOf({ status: "sent" })).toEqual({ sent: true });
    expect(rescheduleSendOf({ status: "skipped", reason: "needs_template" })).toEqual({ sent: false, reason: "needs_template" });
    expect(rescheduleSendOf({ status: "skipped", reason: "opted_out" })).toEqual({ sent: false, reason: "failed" });
    expect(rescheduleSendOf({ status: "failed" })).toEqual({ sent: false, reason: "failed" });
  });

  test("la barra sale desde 5 min después de la hora y hasta 7 días después de terminar", () => {
    const a = { status: "active", callOutcome: null, startsAt: start, endsAt: new Date(start.getTime() + 15 * 60_000) };
    expect(needsOutcomeMark(a, new Date(start.getTime() + 4 * 60_000))).toBe(false);
    expect(needsOutcomeMark(a, new Date(start.getTime() + 5 * 60_000))).toBe(true);
    expect(needsOutcomeMark(a, new Date(a.endsAt.getTime() + 7 * 24 * H))).toBe(true);
    expect(needsOutcomeMark(a, new Date(a.endsAt.getTime() + 7 * 24 * H + 60_000))).toBe(false);
    expect(needsOutcomeMark({ ...a, callOutcome: "answered" }, now)).toBe(false);
    expect(needsOutcomeMark({ ...a, status: "cancelled" }, now)).toBe(false);
  });

  test("cuándo fue: hoy, ayer o la fecha, con a. m./p. m., en la zona de Dayana", () => {
    const tz = "America/Bogota";
    // 00:15 UTC del 16 = 7:15 p. m. del 15 en Bogotá.
    expect(callWhenLabel(start, new Date("2026-10-16T02:00:00Z"), tz)).toBe("de hoy, 7:15 p. m.");
    expect(callWhenLabel(start, new Date("2026-10-16T15:00:00Z"), tz)).toBe("de ayer, 7:15 p. m.");
    expect(callWhenLabel(start, new Date("2026-10-18T15:00:00Z"), tz)).toBe("del jueves 15 de octubre, 7:15 p. m.");
    expect(callWhenLabel(new Date("2026-10-15T14:05:00Z"), new Date("2026-10-15T20:00:00Z"), tz)).toBe("de hoy, 9:05 a. m.");
  });
});

describe("Dayana corrige cómo terminó (tocó el botón equivocado)", () => {
  const base = { sendHours: true, rescheduleSent: false, blocked: false };

  test("Leidy: «Hablaron» por error → «No contestó» sin mensaje (ya se le escribió para reagendar)", () => {
    expect(planOutcomeChange({ ...base, current: "answered", outcome: "no_answer", sendHours: false })).toEqual({
      kind: "change",
      outcome: "no_answer",
      reason: "Dayana lo corrigió en el CRM: no contestó.",
      send: "none",
    });
  });

  test("a «No contestó» con horas: salen si no se le mandaron ya y el chat no está en silencio", () => {
    expect(planOutcomeChange({ ...base, current: "answered", outcome: "no_answer" })).toMatchObject({ kind: "change", send: "reschedule" });
    expect(planOutcomeChange({ ...base, current: "answered", outcome: "no_answer", rescheduleSent: true })).toMatchObject({ send: "none" });
    expect(planOutcomeChange({ ...base, current: "answered", outcome: "no_answer", blocked: true })).toMatchObject({ send: "silenced" });
  });

  test("a «Hablaron»: nunca manda nada", () => {
    expect(planOutcomeChange({ ...base, current: "no_answer", outcome: "answered" })).toEqual({
      kind: "change",
      outcome: "answered",
      reason: "Dayana lo corrigió en el CRM: sí hablaron.",
      send: "none",
    });
  });

  test("lo mismo que ya dice, sin decidir o decidido por el reloj: no se cambia", () => {
    expect(planOutcomeChange({ ...base, current: "answered", outcome: "answered" })).toEqual({ kind: "same" });
    for (const current of [null, "rescheduled", "not_free"]) {
      expect(planOutcomeChange({ ...base, current, outcome: "no_answer" })).toEqual({ kind: "not_changeable" });
    }
  });

  test("se puede cambiar hasta 7 días después de terminar", () => {
    const endsAt = new Date("2026-10-16T00:30:00Z");
    const a = { status: "active", callOutcome: "answered", endsAt };
    expect(canChangeOutcome(a, new Date(endsAt.getTime() + 7 * 24 * H))).toBe(true);
    expect(canChangeOutcome(a, new Date(endsAt.getTime() + 7 * 24 * H + 60_000))).toBe(false);
    expect(canChangeOutcome({ ...a, callOutcome: null }, endsAt)).toBe(false);
    expect(canChangeOutcome({ ...a, callOutcome: "rescheduled" }, endsAt)).toBe(false);
    expect(canChangeOutcome({ ...a, status: "cancelled" }, endsAt)).toBe(false);
  });
});
