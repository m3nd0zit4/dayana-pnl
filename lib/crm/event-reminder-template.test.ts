import { describe, expect, test } from "bun:test";

import {
  EVENT_REMINDER_FALLBACK_TEMPLATE_KEY,
  EVENT_REMINDER_UTILITY_TEMPLATE_KEY,
  isApprovedUtility,
  preferredEventReminderTemplateKey,
} from "./event-reminder-template";
import { STARTER_TEMPLATES, templateBodyProblem, toMetaBody, utilityCategoryWarning } from "./whatsapp-templates";

const U = EVENT_REMINDER_UTILITY_TEMPLATE_KEY;
const F = EVENT_REMINDER_FALLBACK_TEMPLATE_KEY;
// Así quedó en producción: Meta pasó la de siempre a Marketing.
const fallback = { key: F, metaApprovalStatus: "APPROVED", metaCategory: "MARKETING" };

describe("preferredEventReminderTemplateKey", () => {
  test("la de utilidad, en cuanto Meta la aprueba como UTILITY", () => {
    expect(
      preferredEventReminderTemplateKey([fallback, { key: U, metaApprovalStatus: "APPROVED", metaCategory: "UTILITY" }])
    ).toBe(U);
    // Mayúsculas o minúsculas, da igual.
    expect(preferredEventReminderTemplateKey([{ key: U, metaApprovalStatus: "approved", metaCategory: "utility" }])).toBe(U);
  });

  test("en revisión, rechazada o nunca mandada: la de siempre", () => {
    expect(preferredEventReminderTemplateKey([fallback])).toBe(F);
    expect(preferredEventReminderTemplateKey([])).toBe(F);
    expect(
      preferredEventReminderTemplateKey([fallback, { key: U, metaApprovalStatus: "PENDING", metaCategory: "UTILITY" }])
    ).toBe(F);
    expect(
      preferredEventReminderTemplateKey([fallback, { key: U, metaApprovalStatus: "REJECTED", metaCategory: "UTILITY" }])
    ).toBe(F);
  });

  test("si Meta también la pasó a Marketing (o sin categoría): la de siempre", () => {
    expect(
      preferredEventReminderTemplateKey([fallback, { key: U, metaApprovalStatus: "APPROVED", metaCategory: "MARKETING" }])
    ).toBe(F);
    expect(
      preferredEventReminderTemplateKey([fallback, { key: U, metaApprovalStatus: "APPROVED", metaCategory: null }])
    ).toBe(F);
  });

  test("solo cuenta la de utilidad: otra aprobada como UTILITY no cambia nada", () => {
    expect(isApprovedUtility({ key: F, metaApprovalStatus: "APPROVED", metaCategory: "UTILITY" })).toBe(true);
    expect(
      preferredEventReminderTemplateKey([{ key: F, metaApprovalStatus: "APPROVED", metaCategory: "UTILITY" }])
    ).toBe(F);
  });
});

describe("plantilla de utilidad del recordatorio", () => {
  const t = STARTER_TEMPLATES.find((s) => s.key === U);

  test("está entre las recomendadas, como UTILITY y sin palabras de venta ni emojis", () => {
    expect(t).toBeDefined();
    expect(t?.category).toBe("UTILITY");
    expect(templateBodyProblem(t?.body ?? "")).toBeNull();
    expect(utilityCategoryWarning("UTILITY", t?.body ?? "")).toBeNull();
    expect(/\p{Extended_Pictographic}/u.test(t?.body ?? "")).toBe(false);
  });

  test("las mismas variables que la de siempre, con ejemplo para cada una", () => {
    const old = STARTER_TEMPLATES.find((s) => s.key === F);
    const vars = toMetaBody(t?.body ?? "").varNames;
    expect([...vars].sort()).toEqual([...toMetaBody(old?.body ?? "").varNames].sort());
    expect(vars).toEqual(["nombre", "evento", "fecha", "enlace"]);
    for (const v of vars) expect(t?.example[v]).toBeTruthy();
  });
});
