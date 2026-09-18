import { describe, expect, test } from "bun:test";

import { combineWhatsAppMarks } from "./whatsapp-marks";

const at = (iso: string) => new Date(iso);
const created = at("2026-09-10T12:00:00Z");

describe("combineWhatsAppMarks", () => {
  test("sin clics, ninguna marca", () => {
    expect(
      combineWhatsAppMarks({ diagnosticCreatedAt: created, checkoutStartedAt: null }),
    ).toEqual({ leadAt: null, staffAt: null });
  });

  test("el CTA del resultado cuenta como «fue a WhatsApp»", () => {
    const cta = at("2026-09-10T12:05:00Z");
    expect(
      combineWhatsAppMarks({ diagnosticCreatedAt: created, checkoutStartedAt: cta }).leadAt,
    ).toEqual(cta);
  });

  test("gana el clic más reciente de la persona", () => {
    const cta = at("2026-09-10T12:05:00Z");
    const email = at("2026-09-12T09:00:00Z");
    expect(
      combineWhatsAppMarks({
        diagnosticCreatedAt: created,
        checkoutStartedAt: cta,
        contactLeadAt: email,
      }).leadAt,
    ).toEqual(email);
  });

  test("clics anteriores al diagnóstico no cuentan", () => {
    const before = at("2026-09-01T00:00:00Z");
    expect(
      combineWhatsAppMarks({
        diagnosticCreatedAt: created,
        checkoutStartedAt: null,
        contactLeadAt: before,
        contactStaffAt: before,
      }),
    ).toEqual({ leadAt: null, staffAt: null });
  });

  test("el clic del equipo va en su propia marca", () => {
    const staff = at("2026-09-11T15:00:00Z");
    expect(
      combineWhatsAppMarks({
        diagnosticCreatedAt: created,
        checkoutStartedAt: null,
        contactStaffAt: staff,
      }),
    ).toEqual({ leadAt: null, staffAt: staff });
  });

  test("un clic en el mismo instante del diagnóstico cuenta", () => {
    expect(
      combineWhatsAppMarks({
        diagnosticCreatedAt: created,
        checkoutStartedAt: null,
        diagnosticLeadAt: created,
      }).leadAt,
    ).toEqual(created);
  });
});
