import { describe, expect, test } from "bun:test";

import type { MeetConference } from "@/lib/google/meet";
import { isPackageCounter, meetCode, parseEventTitle } from "./event-title";
import { noShowStep, noShowText } from "./no-show-rules";

// «3.6 jesus terapia…», sábado 17-oct, 9:00 p. m. en Bogotá.
const startsAt = new Date("2026-10-18T02:00:00Z");
const at = (min: number) => new Date(startsAt.getTime() + min * 60_000);
const dayana = { id: "111", name: "Dayana Beltrán" };
const meeting = (people: MeetConference["participants"]): MeetConference => ({ startTime: at(-2).toISOString(), endTime: null, participants: people });
const DAYANA = { user: "users/111", displayName: "Dayana Beltrán", joinedAt: at(-2).toISOString(), leftAt: null };
const JESUS = { user: "users/222", displayName: "Jesus R", joinedAt: at(3).toISOString(), leftAt: null };

describe("noShowStep (solo con lo que dice Meet)", () => {
  test("antes de los 12 minutos no se decide nada", () => {
    expect(noShowStep({ startsAt, now: at(8), afterMin: 12, conference: meeting([DAYANA]), dayana })).toEqual({ kind: "wait", reason: "too_early" });
  });

  test("Dayana está y la persona no entró: se manda", () => {
    expect(noShowStep({ startsAt, now: at(12), afterMin: 12, conference: meeting([DAYANA]), dayana })).toEqual({ kind: "send" });
  });

  test("la persona entró (aunque ya haya salido): no se manda", () => {
    expect(noShowStep({ startsAt, now: at(13), afterMin: 12, conference: meeting([DAYANA, JESUS]), dayana }).kind).toBe("joined");
    const left = { ...JESUS, leftAt: at(5).toISOString() };
    expect(noShowStep({ startsAt, now: at(13), afterMin: 12, conference: meeting([DAYANA, left]), dayana }).kind).toBe("joined");
    // Sin cuenta de Google (invitado anónimo) también cuenta como que entró.
    const anon = { user: null, displayName: "Jesús", joinedAt: at(1).toISOString(), leftAt: null };
    expect(noShowStep({ startsAt, now: at(13), afterMin: 12, conference: meeting([DAYANA, anon]), dayana }).kind).toBe("joined");
  });

  test("Dayana no está o nadie abrió la reunión: se espera y luego se deja", () => {
    expect(noShowStep({ startsAt, now: at(12), afterMin: 12, conference: null, dayana })).toEqual({ kind: "wait", reason: "no_conference" });
    expect(noShowStep({ startsAt, now: at(12), afterMin: 12, conference: meeting([]), dayana })).toEqual({ kind: "wait", reason: "dayana_not_in" });
    expect(noShowStep({ startsAt, now: at(40), afterMin: 12, conference: null, dayana }).kind).toBe("give_up");
  });

  test("Dayana se reconoce por su id de Google o por su nombre", () => {
    const byName = { ...DAYANA, user: "users/999" };
    expect(noShowStep({ startsAt, now: at(12), afterMin: 12, conference: meeting([byName]), dayana })).toEqual({ kind: "send" });
  });
});

describe("noShowText", () => {
  test("el mensaje para reagendar, con su nombre y la hora en su zona", () => {
    const text = noShowText({ template: null, name: "Jesus", startsAt, timeZone: "America/Mexico_City" });
    expect(text).toContain("Hola Jesus");
    expect(text).toMatch(/8:00\sp\.\sm\./);
    expect(text).toContain("reagendarla");
  });
  test("sin nombre de persona, sin nombre", () => {
    expect(noShowText({ template: "Hola {nombre} 🙏 Te esperamos a las {hora}.", name: "DIOS ES MI PROVEEDOR 🙏", startsAt, timeZone: "America/Bogota" })).toMatch(/^Hola 🙏 Te esperamos a las 9:00\sp\.\sm\.\.?$/);
  });
});

describe("las sesiones de Dayana en el calendario (17-oct)", () => {
  test("«3.6 jesus terapia…» es la sesión 3 de 6", () => {
    expect(parseEventTitle("3.6 jesus terapia de rerpogramacion neuronal")).toMatchObject({ counter: "3/6" });
    expect(parseEventTitle("12.24 Heidy terapia de Reprogramacion neurona")).toMatchObject({ counter: "12/24" });
    expect(parseEventTitle("3/6 Laura Pérez +573001234567")).toMatchObject({ counter: "3/6", phone: "573001234567" });
    // Una sola sesión pagada (Cristóbal, 7-oct).
    expect(parseEventTitle("1.1 Cristóbal terapia de Reprogramacion neuronal")).toMatchObject({ counter: "1/1" });
  });
  test("lo que no es un contador no se lee como tal", () => {
    expect(parseEventTitle("1.5 horas de grabación").counter).toBeNull();
    expect(parseEventTitle("7.2 limpieza").counter).toBeNull();
    expect(parseEventTitle("0.5 horas").counter).toBeNull();
    expect(parseEventTitle("Live").counter).toBeNull();
  });
  test("contador de paquete y código de Meet", () => {
    expect(isPackageCounter("3/6")).toBe(true);
    expect(isPackageCounter("0/0")).toBe(false);
    expect(isPackageCounter(null)).toBe(false);
    expect(meetCode("https://meet.google.com/ahn-ecia-uyh")).toBe("ahn-ecia-uyh");
    expect(meetCode("Enlace: Https://Meet.google.com/AHN-ECIA-UYH?authuser=0")).toBe("ahn-ecia-uyh");
    expect(meetCode("https://zoom.us/j/123")).toBeNull();
  });
});
