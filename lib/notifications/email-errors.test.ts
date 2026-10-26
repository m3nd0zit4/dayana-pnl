import { describe, expect, test } from "bun:test";

import {
  classifyEmailError,
  deliveryFailureKey,
  isEmailQuotaError,
  isGatedSweepTemplate,
} from "./email-errors";

// Textos tal cual los dejó producción el 24-25 oct 2026.
const QUOTA =
  'Resend error: 429 {"message":"You have reached your daily email sending quota.","name":"daily_quota_exceeded","statusCode":429}';
const INVALID_TO =
  'Resend error: 422 {"message":"Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.","name":"validation_error","statusCode":422}';

describe("isGatedSweepTemplate", () => {
  test("los barridos automáticos del webinar y de los talleres", () => {
    for (const key of [
      "webinar_reminder_1h",
      "webinar_reminder_24h",
      "webinar_meet_link",
      "workshop_reminder_24h",
      "workshop_reminder_1h",
    ]) {
      expect(isGatedSweepTemplate(key)).toBe(true);
    }
  });

  test("lo que se manda de una vez NO: si no sale, hay que saberlo", () => {
    for (const key of ["payment_confirmation", "member_invite", "payment_otp", "WHATSAPP_AI_ESCALATED"]) {
      expect(isGatedSweepTemplate(key)).toBe(false);
    }
    expect(isGatedSweepTemplate(null)).toBe(false);
    expect(isGatedSweepTemplate(undefined)).toBe(false);
  });
});

describe("deliveryFailureKey", () => {
  test("la cuota agrupa por plantilla: el apagón general no se traga el fallo de una confirmación de pago", () => {
    expect(deliveryFailureKey("EMAIL", "quota", "payment_confirmation")).toBe(
      "EMAIL:quota:payment_confirmation"
    );
    expect(deliveryFailureKey("EMAIL", "quota", "member_invite")).toBe("EMAIL:quota:member_invite");
    expect(deliveryFailureKey("EMAIL", "quota", undefined)).toBe("EMAIL:quota:-");
  });

  test("una dirección inválida agrupa por causa, sin mirar la plantilla", () => {
    expect(deliveryFailureKey("EMAIL", "invalid_address", "member_invite")).toBe(
      "EMAIL:invalid_address"
    );
  });

  test("sin causa conocida agrupa por plantilla: un recordatorio no tapa una confirmación de pago", () => {
    expect(deliveryFailureKey("EMAIL", "other", "webinar_reminder_1h")).toBe(
      "EMAIL:webinar_reminder_1h"
    );
    expect(deliveryFailureKey("EMAIL", "other", "payment_confirmation")).toBe(
      "EMAIL:payment_confirmation"
    );
    expect(deliveryFailureKey("SMS", "other", undefined)).toBe("SMS:-");
  });
});

describe("classifyEmailError", () => {
  test("cuota diaria agotada", () => {
    expect(classifyEmailError(QUOTA)).toBe("quota");
    expect(isEmailQuotaError(QUOTA)).toBe(true);
  });

  test("cuota mensual también", () => {
    expect(
      classifyEmailError(
        'Resend error: 429 {"message":"monthly limit","name":"monthly_quota_exceeded","statusCode":429}'
      )
    ).toBe("quota");
  });

  test("el límite de ritmo NO es la cuota: se resuelve esperando", () => {
    expect(
      classifyEmailError(
        'Resend error: 429 {"message":"Too many requests","name":"rate_limit_exceeded","statusCode":429}'
      )
    ).toBe("other");
  });

  test("dirección inválida", () => {
    expect(classifyEmailError(INVALID_TO)).toBe("invalid_address");
  });

  test("otro 422 de Resend no se toma por dirección inválida", () => {
    expect(
      classifyEmailError(
        'Resend error: 422 {"message":"Invalid `from` field.","name":"validation_error","statusCode":422}'
      )
    ).toBe("other");
  });

  test("lo demás, y la ausencia de mensaje, son «other»", () => {
    expect(classifyEmailError("Resend error: 500 boom")).toBe("other");
    expect(classifyEmailError("socket hang up")).toBe("other");
    expect(classifyEmailError(null)).toBe("other");
    expect(classifyEmailError(undefined)).toBe("other");
    expect(isEmailQuotaError("")).toBe(false);
  });
});
