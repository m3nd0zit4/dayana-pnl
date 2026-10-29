import { describe, expect, test } from "bun:test";

import { INVITE_TEMPLATE_KEY } from "./workshop-invite-rules";
import { REGISTRATION_TEMPLATE_KEY } from "./workshop-registration-rules";
import { STARTER_TEMPLATES } from "./whatsapp-templates";
import { rejectedReason, WORKSHOP_TEMPLATE_KEYS, WORKSHOP_TEMPLATES, workshopTemplateSpec, workshopTemplateState } from "./workshop-templates-rules";

// Las dos plantillas del taller en «Interesadas» (29-oct).
const REG = workshopTemplateSpec(REGISTRATION_TEMPLATE_KEY)!;
const INV = workshopTemplateSpec(INVITE_TEMPLATE_KEY)!;

describe("las plantillas del taller", () => {
  test("son las dos, con la categoría que se le pide a Meta (la de las recomendadas)", () => {
    expect(WORKSHOP_TEMPLATE_KEYS).toEqual([REGISTRATION_TEMPLATE_KEY, INVITE_TEMPLATE_KEY]);
    for (const spec of WORKSHOP_TEMPLATES) {
      const starter = STARTER_TEMPLATES.find((t) => t.key === spec.key);
      expect(starter?.category).toBe(spec.category);
      expect(starter?.title).toBe(spec.title);
    }
    expect(REG.category).toBe("UTILITY");
    expect(INV.category).toBe("MARKETING");
  });
});

describe("workshopTemplateState: cómo está en Meta", () => {
  test("nunca se mandó: se puede mandar y dice qué pasa mientras tanto", () => {
    const s = workshopTemplateState(REG, null);
    expect(s).toMatchObject({ kind: "none", label: "Sin mandar a Meta", tone: "warn", submittable: true });
    expect(s.detail).toContain("no les llega el WhatsApp del registro");
    expect(workshopTemplateState(INV, { status: null, category: null }).kind).toBe("none");
  });
  test("en revisión (también lo que 360dialog dice mientras: IN_APPEAL): no se vuelve a mandar", () => {
    expect(workshopTemplateState(REG, { status: "PENDING", category: "UTILITY" })).toMatchObject({
      kind: "pending",
      label: "En revisión de Meta",
      submittable: false,
    });
    expect(workshopTemplateState(INV, { status: "IN_APPEAL", category: "MARKETING" }).kind).toBe("pending");
  });
  test("aprobada como Utilidad (la del registro) y como Marketing (la invitación, que se pidió así)", () => {
    expect(workshopTemplateState(REG, { status: "APPROVED", category: "UTILITY" })).toMatchObject({
      kind: "approved",
      label: "Aprobada como Utilidad",
      tone: "ok",
      submittable: false,
    });
    expect(workshopTemplateState(INV, { status: "APPROVED", category: "MARKETING" })).toMatchObject({
      kind: "approved",
      label: "Aprobada como Marketing",
      tone: "ok",
    });
  });
  test("la de Utilidad que Meta pasó a Marketing: se dice claro y no se manda otra vez", () => {
    const s = workshopTemplateState(REG, { status: "APPROVED", category: "MARKETING" });
    expect(s).toMatchObject({ kind: "marketing", label: "Meta la pasó a Marketing", tone: "warn", submittable: false });
    expect(s.detail).toContain("no se envía sola");
  });
  test("rechazada: con el motivo en español y se puede mandar otra vez", () => {
    const s = workshopTemplateState(REG, { status: "REJECTED · INVALID_FORMAT", category: "UTILITY" });
    expect(s).toMatchObject({ kind: "rejected", label: "Rechazada por Meta", submittable: true });
    expect(s.detail).toContain("el formato no es válido");
    expect(s.detail).toContain("(INVALID_FORMAT)");
    // Sin motivo (o «NONE»): solo que la rechazó.
    expect(workshopTemplateState(INV, { status: "REJECTED", category: "MARKETING" }).detail.startsWith("Puedes mandarla")).toBe(true);
    expect(rejectedReason("REJECTED · NONE")).toBeNull();
    expect(rejectedReason("REJECTED · SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(rejectedReason("REJECTED · INCORRECT_CATEGORY")).toContain("categoría");
  });
  test("pausada o quitada: no se manda (el nombre ya está tomado)", () => {
    expect(workshopTemplateState(INV, { status: "PAUSED", category: "MARKETING" })).toMatchObject({ kind: "paused", submittable: false });
    expect(workshopTemplateState(INV, { status: "DISABLED", category: "MARKETING" }).label).toBe("Desactivada por Meta");
    expect(workshopTemplateState(REG, { status: "DELETED", category: "UTILITY" })).toMatchObject({ kind: "deleted", submittable: false });
  });
});
