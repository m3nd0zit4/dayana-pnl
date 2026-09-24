import { describe, expect, test } from "bun:test";

import {
  fillVars,
  firstName,
  isOptOutMessage,
  planSend,
  summarizePlans,
  templateParams,
} from "./whatsapp-outbound-plan";

describe("planSend", () => {
  test("dentro de 24 h: texto libre", () => {
    expect(planSend({ hasPhone: true, optedOut: false, windowOpen: true, hasApprovedTemplate: false })).toEqual({
      action: "text",
    });
  });
  test("fuera de 24 h: plantilla si hay, si no se salta", () => {
    expect(planSend({ hasPhone: true, optedOut: false, windowOpen: false, hasApprovedTemplate: true })).toEqual({
      action: "template",
    });
    expect(planSend({ hasPhone: true, optedOut: false, windowOpen: false, hasApprovedTemplate: false })).toEqual({
      action: "skip",
      reason: "needs_template",
    });
  });
  test("sin número o dada de baja: nunca", () => {
    expect(planSend({ hasPhone: false, optedOut: false, windowOpen: true, hasApprovedTemplate: true }).action).toBe("skip");
    expect(planSend({ hasPhone: true, optedOut: true, windowOpen: true, hasApprovedTemplate: true })).toEqual({
      action: "skip",
      reason: "opted_out",
    });
  });
});

describe("variables", () => {
  test("rellena y quita lo que falta", () => {
    expect(fillVars("Hola {{nombre}}, el {{evento}} es {{fecha}}.", { nombre: "Ana", evento: "taller" })).toBe(
      "Hola Ana, el taller es ."
    );
  });
  test("parámetros de plantilla en orden, con guion si faltan", () => {
    expect(templateParams(["nombre", "enlace"], { nombre: "Ana" })).toEqual(["Ana", "-"]);
  });
  test("primer nombre", () => {
    expect(firstName("  María José Pérez ")).toBe("María");
  });
});

describe("bajas", () => {
  test("detecta pedidos cortos de no escribir más", () => {
    expect(isOptOutMessage("STOP")).toBe(true);
    expect(isOptOutMessage("No me escribas más!")).toBe(true);
    expect(isOptOutMessage("no más mensajes")).toBe(true);
  });
  test("no confunde una frase larga", () => {
    expect(isOptOutMessage("no más tristeza en mi vida, quiero sanar")).toBe(false);
    expect(isOptOutMessage("Hola")).toBe(false);
  });
});

describe("resumen", () => {
  test("cuenta y estima costo solo de plantillas", () => {
    const s = summarizePlans(
      [
        { action: "text" },
        { action: "template" },
        { action: "template" },
        { action: "skip", reason: "no_phone" },
      ],
      0.05
    );
    expect(s).toMatchObject({ total: 4, text: 1, template: 2, estimatedCost: 0.1 });
    expect(s.skipped.no_phone).toBe(1);
  });
});
