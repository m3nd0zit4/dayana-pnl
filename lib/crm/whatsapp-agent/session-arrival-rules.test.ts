import { describe, expect, test } from "bun:test";

import type { MeetConference } from "@/lib/google/meet";
import { arrivalNotice, arrivalStep, inArrivalWindow, saysWaitingInRoom } from "./session-arrival-rules";

const startsAt = new Date("2026-10-19T20:00:00Z");
const at = (min: number) => new Date(startsAt.getTime() + min * 60_000);
const dayana = { id: "111", name: "Dayana Beltrán" };
const meeting = (people: MeetConference["participants"]): MeetConference => ({ startTime: at(-3).toISOString(), endTime: null, participants: people });
const DAYANA = { user: "users/111", displayName: "Dayana Beltrán", joinedAt: at(1).toISOString(), leftAt: null };
const JESUS = { user: null, displayName: "Jesus R", joinedAt: at(-2).toISOString(), leftAt: null };

describe("saysWaitingInRoom", () => {
  test("ya está o no la dejan entrar", () => {
    for (const s of [
      "Ya estoy en la sala",
      "ya me conecté",
      "Estoy esperando",
      "no me deja entrar",
      "No puedo entrar a la reunión",
      "Me aceptas porfa?",
      "le di a solicitar unirme",
      "pedí permiso para entrar",
      "ya estoy",
      "Dayana te estoy esperando",
      "Sigo esperando",
    ]) {
      expect(saysWaitingInRoom(s)).toBe(true);
    }
  });
  test("lo de siempre no", () => {
    for (const s of ["Hola", "ya", "Ya te transferí", "gracias", "voy en camino", "ya voy", "¿a qué hora es?", "estoy bien"]) {
      expect(saysWaitingInRoom(s)).toBe(false);
    }
  });
});

describe("inArrivalWindow", () => {
  test("de 15 min antes a 45 min después", () => {
    expect(inArrivalWindow(startsAt, at(-16))).toBe(false);
    expect(inArrivalWindow(startsAt, at(-15))).toBe(true);
    expect(inArrivalWindow(startsAt, at(30))).toBe(true);
    expect(inArrivalWindow(startsAt, at(46))).toBe(false);
  });
});

describe("arrivalStep (lo que dice Meet)", () => {
  test("entró la persona y Dayana no: avisar", () => {
    expect(arrivalStep(meeting([JESUS]), dayana)).toEqual({ kind: "notify", meetName: "Jesus R" });
  });
  test("Dayana ya está: ella ve quién entra", () => {
    expect(arrivalStep(meeting([JESUS, DAYANA]), dayana)).toEqual({ kind: "dayana_in" });
  });
  test("nadie, o la persona ya salió", () => {
    expect(arrivalStep(null, dayana)).toEqual({ kind: "nobody" });
    expect(arrivalStep(meeting([{ ...JESUS, leftAt: at(1).toISOString() }]), dayana)).toEqual({ kind: "nobody" });
  });
  test("Dayana sin cuenta en el participante: se reconoce por su nombre", () => {
    expect(arrivalStep(meeting([{ ...DAYANA, user: null }]), dayana)).toEqual({ kind: "dayana_in" });
  });
});

describe("arrivalNotice", () => {
  test("desde Meet, con el nombre que se ve allí", () => {
    expect(arrivalNotice({ who: "Jesús", hour: "3:00 p. m.", source: "meet", meetName: "Jesus R" })).toEqual({
      title: "Jesús te espera en Meet",
      body: "Entró a la sala de su sesión de las 3:00 p. m. (en Meet aparece como «Jesus R») y tú todavía no estás.",
    });
  });
  test("mismo nombre en Meet: no se repite", () => {
    expect(arrivalNotice({ who: "Jesus R", hour: "3:00 p. m.", source: "meet", meetName: "Jesús R" }).body).not.toContain("aparece");
  });
  test("desde el chat, con lo que escribió", () => {
    expect(arrivalNotice({ who: "Jesús", hour: "3:00 p. m.", source: "chat", quote: "no me deja entrar" })).toEqual({
      title: "Jesús te espera en la sala",
      body: "Te escribió: «no me deja entrar» (sesión de las 3:00 p. m.). Si pidió permiso para entrar, acepta su solicitud en Meet.",
    });
  });
});
