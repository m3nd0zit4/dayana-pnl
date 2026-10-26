import { describe, expect, test } from "bun:test";

import {
  classifyEmailError,
  deliveryFailureKey,
  isEmailQuotaError,
} from "./email-errors";

// Textos tal cual los dejó producción el 24-25 oct 2026.
const QUOTA =
  'Resend error: 429 {"message":"You have reached your daily email sending quota.","name":"daily_quota_exceeded","statusCode":429}';
const INVALID_TO =
  'Resend error: 422 {"message":"Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.","name":"validation_error","statusCode":422}';

describe("deliveryFailureKey", () => {
  test("una causa conocida agrupa por canal y causa, sin mirar la plantilla", () => {
    expect(deliveryFailureKey("EMAIL", "quota", "webinar_reminder_1h")).toBe("EMAIL:quota");
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
