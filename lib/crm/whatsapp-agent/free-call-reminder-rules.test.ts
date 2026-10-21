import { describe, expect, test } from "bun:test";

import { isAutoSend, isHumanSend } from "../whatsapp-attention-rules";
import {
  clampReminderMinutes,
  DEFAULT_FREE_CALL_REMINDER,
  freeCallReminderText,
  soonReminderDecision,
  soonReminderWindow,
} from "./free-call-reminder-rules";

const NOW = new Date("2026-10-16T21:00:00Z"); // 4:00 p. m. en Colombia
const inMin = (m: number) => new Date(NOW.getTime() + m * 60_000);
const decide = (startMin: number, bookedMinBeforeStart: number | null = 3 * 24 * 60, minutesBefore = 60) =>
  soonReminderDecision({
    startsAt: inMin(startMin),
    bookedAt: bookedMinBeforeStart === null ? null : inMin(startMin - bookedMinBeforeStart),
    now: NOW,
    minutesBefore,
  }).kind;

describe("cuándo sale el recordatorio de 1 h", () => {
  test("una hora antes sale; falta más de 70 min, todavía no", () => {
    expect(decide(60)).toBe("send");
    expect(decide(55)).toBe("send");
    expect(decide(70)).toBe("send"); // el reloj pasa cada 5–10 min: hasta 10 antes de lo pedido
    expect(decide(71)).toBe("not_yet");
    expect(decide(24 * 60)).toBe("not_yet");
  });

  test("si el reloj llega tarde, todavía sale hasta 15 min antes; más cerca, no", () => {
    expect(decide(20)).toBe("send");
    expect(decide(15)).toBe("send");
    expect(decide(14)).toBe("too_late");
    expect(decide(-5)).toBe("too_late");
  });

  test("agendada poco antes (menos de 90 min): no hace falta, la confirmación ya le dijo la hora", () => {
    const d = soonReminderDecision({ startsAt: inMin(55), bookedAt: inMin(55 - 40), now: NOW, minutesBefore: 60 });
    expect(d.kind).toBe("skip");
    expect(d.kind === "skip" && d.reason).toContain("40 min");
    expect(decide(55, 89)).toBe("skip");
    expect(decide(55, 90)).toBe("send");
    expect(decide(55, null)).toBe("send"); // sin dato de cuándo se agendó, se manda
  });

  test("Dayana ya le escribió antes de la llamada (Paola: 8:40 para la de 9:30): no se manda", () => {
    const base = { startsAt: inMin(50), bookedAt: inMin(-3 * 24 * 60), now: NOW, minutesBefore: 60 };
    const d = soonReminderDecision({ ...base, dayanaWroteAt: inMin(-3) });
    expect(d.kind).toBe("skip");
    expect(d.kind === "skip" && d.reason).toContain("Dayana ya le escribió");
    // Lo de ayer (o de más de 3 h antes de la llamada) no cuenta.
    expect(soonReminderDecision({ ...base, dayanaWroteAt: inMin(50 - 181) }).kind).toBe("send");
    expect(soonReminderDecision({ ...base, dayanaWroteAt: null }).kind).toBe("send");
  });

  test("con otros minutos la ventana se mueve; fuera de 30–180 se ajusta", () => {
    expect(decide(120, 3 * 24 * 60, 120)).toBe("send");
    expect(decide(131, 3 * 24 * 60, 120)).toBe("not_yet");
    expect(decide(55, 140, 120)).toBe("skip"); // 120 + 30
    expect(clampReminderMinutes(5)).toBe(30);
    expect(clampReminderMinutes(999)).toBe(180);
    expect(clampReminderMinutes(75.4)).toBe(75);
    expect(soonReminderWindow(NOW, 5)).toEqual({ from: inMin(15), to: inMin(40) });
    expect(soonReminderWindow(NOW, 60)).toEqual({ from: inMin(15), to: inMin(70) });
  });
});

describe("el texto del recordatorio", () => {
  const at615pm = new Date("2026-10-16T23:15:00Z"); // 6:15 p. m. en Bogotá

  test("con nombre, la hora con a. m./p. m. en su zona, con la voz de la asistente", () => {
    expect(freeCallReminderText({ name: "Rosa", startsAt: at615pm, timeZone: "America/Bogota" })).toBe(
      "Hola Rosa 🙏 Te recuerdo que hoy a las 6:15 p. m. Dayana te llamará por WhatsApp a este número para tu llamada gratis. Por favor ten a mano un espacio tranquilo para que puedan hablar con calma."
    );
    expect(freeCallReminderText({ name: "Ana", startsAt: new Date("2026-10-16T14:15:00Z"), timeZone: "America/Bogota" })).toContain(
      "hoy a las 9:15 a. m. Dayana"
    );
  });

  test("en la zona de la persona, no en la de Colombia", () => {
    expect(freeCallReminderText({ name: "Rosa", startsAt: at615pm, timeZone: "America/Mexico_City" })).toContain("a las 5:15 p. m.");
    expect(freeCallReminderText({ name: "Rosa", startsAt: at615pm, timeZone: "Europe/Madrid" })).toContain("a las 1:15 a. m.");
  });

  test("sin nombre (o con un perfil que no es un nombre): «Hola 🙏», sin espacios de más", () => {
    for (const name of [null, "", "DIOS ES MI PROVEEDOR 🙏", "SF"]) {
      const text = freeCallReminderText({ name, startsAt: at615pm, timeZone: "America/Bogota" });
      expect(text.startsWith("Hola 🙏 Te recuerdo que hoy")).toBe(true);
      expect(text).not.toMatch(/\s{2,}| ,/);
    }
    expect(freeCallReminderText({ name: "ENNY jose", startsAt: at615pm, timeZone: "America/Bogota" })).toStartWith("Hola Enny 🙏");
  });

  test("sin corazones ni apodos, sin género, y nunca «te llamo yo»", () => {
    const text = freeCallReminderText({ name: "Rosa", startsAt: at615pm, timeZone: "America/Bogota" });
    expect(text).not.toMatch(/💛|❤|🤍|💕|🥰/u);
    expect(text).not.toMatch(/querid|cariño|hermos/i);
    expect(text).not.toMatch(/\blist[ao]s?\b/i);
    expect(text).toContain("ten a mano un espacio tranquilo");
    expect(text).toContain("Dayana te llamará");
    expect(text).not.toMatch(/te llamo\b/i);
    // Lo que alguien escriba en Ajustes pasa por el mismo filtro de tono.
    const custom = freeCallReminderText({
      template: "Hola querida {{nombre}} 💛 hoy a las {{hora}} te llama Dayana.",
      name: "Rosa",
      startsAt: at615pm,
      timeZone: "America/Bogota",
    });
    expect(custom).not.toMatch(/💛|querid/iu);
    expect(custom).toContain("Rosa");
    expect(custom).toContain("6:15 p. m.");
  });

  test("el texto de Ajustes: vacío es el de siempre, y {nombre} con una llave también vale", () => {
    const base = { name: "Rosa", startsAt: at615pm, timeZone: "America/Bogota" };
    expect(freeCallReminderText({ ...base, template: "  " })).toBe(freeCallReminderText(base));
    expect(freeCallReminderText({ ...base, template: "Hola {nombre}, hoy a las {hora} te llama Dayana." })).toBe(
      "Hola Rosa, hoy a las 6:15 p. m. te llama Dayana."
    );
    expect(DEFAULT_FREE_CALL_REMINDER).toContain("{{nombre}}");
    expect(DEFAULT_FREE_CALL_REMINDER).toContain("{{hora}}");
  });
});

describe("el recordatorio de 1 h sale solo", () => {
  test("no cuenta como respuesta de Dayana ni la IA aprende de él", () => {
    expect(isAutoSend({ source: "recordatorio:1h:evt1" })).toBe(true);
    expect(isAutoSend({ clientKey: "reminder:1h:evt1:1760652900000" })).toBe(true);
    expect(isHumanSend({ isAutoReply: true, source: "recordatorio:1h:evt1" })).toBe(false);
  });
});
