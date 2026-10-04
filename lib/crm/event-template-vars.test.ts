import { describe, expect, test } from "bun:test";

import {
  EVENT_ACCESS_TEMPLATE_KEY,
  EVENT_INVITATION_IMAGE_TEMPLATE_KEY,
  EVENT_INVITATION_TEMPLATE_KEY,
  EVENT_REMINDER_FALLBACK_TEMPLATE_KEY,
  EVENT_REMINDER_UTILITY_TEMPLATE_KEY,
  preferredEventReminderTemplateKey,
} from "./event-reminder-template";
import { SCHEDULE_VAR_NAMES } from "./event-schedule";
import {
  EVENT_ACCESS_BODY,
  EVENT_INVITATION_BODY,
  eventTemplateVars,
  renderEventTemplate,
  sanitizeMensaje,
  workshopPriceLabel,
} from "./event-template-vars";
import { MESSAGE_SLOT, freeEventPresetsFor, resolvePresetVars, workshopPresets } from "./whatsapp-presets";
import { META_BODY_MAX, toMetaBody, utilityCategoryWarning } from "./whatsapp-template-rules";
import { STARTER_TEMPLATES, ensureTemplatesSubmitted, starterLinkForRemote, templateBodyProblem } from "./whatsapp-templates";

const STARTS = new Date("2026-10-04T14:30:00Z");
const event = {
  headline: "Reprograma tu mente\ncon PNL",
  slug: "reprograma",
  startsAt: STARTS,
  startsAtHasTime: true,
  meetUrl: "https://meet.google.com/abc-defg-hij",
};
const starter = (key: string) => STARTER_TEMPLATES.find((s) => s.key === key)!;

describe("plantillas con horarios", () => {
  test.each([EVENT_ACCESS_TEMPLATE_KEY, EVENT_INVITATION_TEMPLATE_KEY, EVENT_INVITATION_IMAGE_TEMPLATE_KEY])(
    "%s cabe en 1024 caracteres ya convertida a {{1}}… y cumple las reglas de Meta",
    (key) => {
      const t = starter(key);
      const meta = toMetaBody(t.body).text;
      expect(meta.length).toBeLessThanOrEqual(META_BODY_MAX);
      expect(templateBodyProblem(t.body)).toBeNull();
      for (const v of toMetaBody(t.body).varNames) expect(t.example[v]).toBeTruthy();
    }
  );

  test("evento_acceso: UTILITY, sin palabras de venta ni más emojis que las banderas y la flecha", () => {
    const t = starter(EVENT_ACCESS_TEMPLATE_KEY);
    expect(t.category).toBe("UTILITY");
    expect(t.body).toBe(EVENT_ACCESS_BODY);
    expect(utilityCategoryWarning("UTILITY", t.body)).toBeNull();
    const withoutFlagsAndArrow = t.body.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").replace(/➜/g, "");
    expect(/\p{Extended_Pictographic}/u.test(withoutFlagsAndArrow)).toBe(false);
    expect(toMetaBody(t.body).varNames).toEqual(["nombre", "evento", "fecha", "enlace", ...SCHEDULE_VAR_NAMES]);
  });

  test("las invitaciones: MARKETING; la de imagen es manual y con el mismo cuerpo", () => {
    expect(starter(EVENT_INVITATION_TEMPLATE_KEY).category).toBe("MARKETING");
    expect(starter(EVENT_INVITATION_TEMPLATE_KEY).body).toBe(EVENT_INVITATION_BODY);
    const img = starter(EVENT_INVITATION_IMAGE_TEMPLATE_KEY);
    expect(img.manual).toBe(true);
    expect(img.body).toBe(EVENT_INVITATION_BODY);
    expect(toMetaBody(img.body).varNames).toEqual([
      "nombre",
      "mensaje",
      "evento",
      "fecha",
      "precio",
      ...SCHEDULE_VAR_NAMES,
      "enlace",
    ]);
  });

  test("las cuatro de antes quedan retiradas, con su reemplazo", () => {
    expect(starter("evento_gratis_invitacion").replacedBy).toEqual([EVENT_INVITATION_TEMPLATE_KEY]);
    expect(starter("taller_invitacion").replacedBy).toEqual([EVENT_INVITATION_TEMPLATE_KEY]);
    expect(starter("taller_recordatorio").replacedBy).toEqual([EVENT_ACCESS_TEMPLATE_KEY]);
    expect(starter("evento_gratis_recordatorio").replacedBy).toEqual([
      EVENT_ACCESS_TEMPLATE_KEY,
      EVENT_REMINDER_UTILITY_TEMPLATE_KEY,
    ]);
  });

  test("ni las retiradas ni la de imagen se mandan solas a aprobar (sin tocar la base)", async () => {
    const r = await ensureTemplatesSubmitted(["taller_recordatorio", EVENT_INVITATION_IMAGE_TEMPLATE_KEY]);
    expect(r).toEqual({ submitted: [], failed: [] });
  });
});

describe("sincronizar: una plantilla del Hub con el nombre de una recomendada", () => {
  test("se liga a su clave, con las variables en el orden de la recomendada", () => {
    const link = starterLinkForRemote("evento_invitacion_imagen");
    expect(link?.key).toBe(EVENT_INVITATION_IMAGE_TEMPLATE_KEY);
    expect(link?.metaVarNames).toEqual(toMetaBody(EVENT_INVITATION_BODY).varNames);
    expect(link?.metaVarNames[0]).toBe("nombre");
    expect(link?.metaVarNames[1]).toBe("mensaje");
  });
  test("una que no es de ninguna recomendada: null (queda como wa_…)", () => {
    expect(starterLinkForRemote("masterclass_gratuita_20261004")).toBeNull();
  });
});

describe("eventTemplateVars", () => {
  test("inscrita: el enlace de la reunión, la fecha en Colombia y una hora por región", () => {
    const v = eventTemplateVars(event, { for: "inscrita" });
    expect(v.evento).toBe("«Reprograma tu mente con PNL»");
    expect(v.fecha).toBe("domingo 4 de octubre");
    expect(v.enlace).toBe(event.meetUrl);
    expect(v.precio).toBe("Gratis");
    expect(v.hora_co).toBe("9:30 a. m.");
    expect(v.hora_uk).toBe("3:30 p. m.");
    expect(v).not.toHaveProperty("nombre");
    for (const value of Object.values(v)) expect(value).not.toMatch(/[\n\t]| {4,}/);
  });

  test("invitación: la página pública; sin reunión, la inscrita también va a la página", () => {
    expect(eventTemplateVars(event, { for: "invitacion" }).enlace).toMatch(/\/eventos-gratuitos\/reprograma$/);
    expect(eventTemplateVars({ ...event, meetUrl: null }, { for: "inscrita" }).enlace).toMatch(
      /\/eventos-gratuitos\/reprograma$/
    );
  });

  test("taller: su página, su precio y sin hora «por confirmar»", () => {
    const w = { title: "Sanando", slug: "sanando", startsAt: STARTS, startsAtHasTime: false, prices: { cop: 150000, usd: 4000 } };
    const v = eventTemplateVars(w, { for: "invitacion" });
    expect(v.enlace).toMatch(/\/taller-virtual\/sanando$/);
    expect(v.precio).toBe("$ 150.000 COP · US$40");
    expect(v.hora_mx).toBe("por confirmar");
    expect(workshopPriceLabel(null)).toBe("Mira el precio en la página de inscripción");
  });

  test("«Tu mensaje»: una línea, espacios colapsados, hasta 300", () => {
    expect(sanitizeMensaje("hola\n\nte  invito\t a   esto ")).toBe("hola te invito a esto");
    expect(sanitizeMensaje("x".repeat(400))).toHaveLength(300);
    expect(eventTemplateVars(event, { for: "invitacion", mensaje: "a\nb" }).mensaje).toBe("a b");
  });

  test("texto libre: la plantilla llena; sin nombre, «Hola,»", () => {
    const v = eventTemplateVars(event, { for: "inscrita" });
    const text = renderEventTemplate(EVENT_ACCESS_BODY, v, "Ana");
    expect(text.startsWith("Hola Ana, te escribimos porque te inscribiste en «Reprograma tu mente con PNL».")).toBe(true);
    expect(text).toContain("🇲🇽 🇨🇷 🇬🇹 🇸🇻 🇭🇳 🇳🇮 ➜ 8:30 a. m.");
    expect(text).not.toContain("{{");
    expect(renderEventTemplate(EVENT_ACCESS_BODY, v, "").startsWith("Hola, te escribimos")).toBe(true);
  });
});

describe("recordatorio de 24 h: evento_acceso cuando Meta la aprueba como UTILITY", () => {
  const ok = (key: string, metaCategory = "UTILITY") => ({ key, metaApprovalStatus: "APPROVED", metaCategory });
  test("24 h con evento_acceso aprobada como UTILITY", () => {
    expect(preferredEventReminderTemplateKey([ok(EVENT_ACCESS_TEMPLATE_KEY)], "24h")).toBe(EVENT_ACCESS_TEMPLATE_KEY);
  });
  test("1 h sigue con la corta (o la de siempre)", () => {
    const rows = [ok(EVENT_ACCESS_TEMPLATE_KEY), ok(EVENT_REMINDER_UTILITY_TEMPLATE_KEY)];
    expect(preferredEventReminderTemplateKey(rows, "1h")).toBe(EVENT_REMINDER_UTILITY_TEMPLATE_KEY);
    expect(preferredEventReminderTemplateKey([ok(EVENT_ACCESS_TEMPLATE_KEY)], "1h")).toBe(
      EVENT_REMINDER_FALLBACK_TEMPLATE_KEY
    );
  });
  test("si Meta la pasó a Marketing, el de 24 h vuelve a lo de hoy", () => {
    expect(preferredEventReminderTemplateKey([ok(EVENT_ACCESS_TEMPLATE_KEY, "MARKETING")], "24h")).toBe(
      EVENT_REMINDER_FALLBACK_TEMPLATE_KEY
    );
  });
});

describe("mensajes listos con horarios", () => {
  test("evento actual: primero el acceso con horarios, con el texto ya lleno", () => {
    const [acceso] = freeEventPresetsFor({ selected: event, selectedUpcoming: true, openEvent: null }, "America/Bogota");
    expect(acceso.id).toBe("acceso");
    expect(acceso.templateKey).toBe(EVENT_ACCESS_TEMPLATE_KEY);
    expect(acceso.text.startsWith("Hola {{nombre}}, te escribimos")).toBe(true);
    expect(acceso.text).toContain("➜ 9:30 a. m.");
    expect(acceso.text.match(/\{\{\w+\}\}/g)).toEqual(["{{nombre}}"]);
  });

  test("invitación con horarios: «Tu mensaje» llena {{mensaje}}; la de imagen solo si está aprobada", () => {
    const p = freeEventPresetsFor({ selected: null, selectedUpcoming: false, openEvent: event }, "America/Bogota");
    const inv = p.find((x) => x.id === "invitacion_horarios")!;
    expect(inv.templateKey).toBe(EVENT_INVITATION_TEMPLATE_KEY);
    expect(inv.vars?.mensaje).toBe(MESSAGE_SLOT);
    expect(inv.text).toContain("Hola {{nombre}}, {{mensaje}}");
    expect(inv.text).toContain("💰 Gratis");
    expect(resolvePresetVars(inv.vars, inv.text, "te invito\na mi clase")?.mensaje).toBe("te invito a mi clase");
    const img = p.find((x) => x.id === "invitacion_imagen")!;
    expect(img.imageTemplate).toBe(true);
    expect(img.templateKey).toBe(EVENT_INVITATION_IMAGE_TEMPLATE_KEY);
    // La de antes sigue (respaldo mientras Meta aprueba la nueva).
    expect(p.some((x) => x.templateKey === "evento_gratis_invitacion")).toBe(true);
  });

  test("taller: acceso con su enlace e invitación con su precio", () => {
    const p = workshopPresets(
      {
        title: "Sanando",
        slug: "sanando",
        startsAt: STARTS,
        dateLabel: null,
        meetingUrl: "https://meet.google.com/x",
        prices: { cop: 150000, usd: null },
      },
      "America/Bogota"
    );
    expect(p.find((x) => x.id === "acceso")?.vars?.enlace).toBe("https://meet.google.com/x");
    expect(p.find((x) => x.id === "invitacion_horarios")?.vars?.precio).toBe("$ 150.000 COP");
  });
});
