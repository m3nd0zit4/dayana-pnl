import { describe, expect, test } from "bun:test";

import { getSiteUrl } from "@/lib/site-url";
import {
  EVENT_REMINDER_FALLBACK_TEMPLATE_KEY,
  EVENT_REMINDER_UTILITY_TEMPLATE_KEY,
  preferredEventReminderTemplateKey,
} from "./event-reminder-template";
import {
  eventDateText,
  freeEventPresets,
  freeEventPresetsFor,
  LINK_SLOT,
  presetMissingLink,
  resolvePresetVars,
  workshopPresets,
  type FreeEventPresetEvent,
} from "./whatsapp-presets";

const TZ = "America/Bogota";
const MEET = "https://meet.google.com/abc-defg-hij";
const landing = () => `${getSiteUrl()}/eventos-gratuitos`;

// Domingo 4 de octubre de 2026, 9:30 a. m. en Bogotá (UTC-5).
const event: FreeEventPresetEvent = {
  headline: "Sanar la relación con mamá",
  startsAt: new Date("2026-10-04T14:30:00Z"),
  startsAtHasTime: true,
  meetUrl: MEET,
};

const byId = <T extends { id: string }>(presets: T[], id: string) =>
  presets.find((p) => p.id === id);

describe("eventDateText", () => {
  test("empieza por el día de la semana, sin coma, con «a las»", () => {
    expect(eventDateText(event.startsAt, true, TZ)).toBe(
      "domingo 4 de octubre a las 9:30 a. m."
    );
  });

  test("la una: «a la 1:00»", () => {
    expect(eventDateText(new Date("2026-10-04T18:00:00Z"), true, TZ)).toBe(
      "domingo 4 de octubre a la 1:00 p. m."
    );
  });

  test("sin hora: solo el día", () => {
    expect(eventDateText(event.startsAt, false, TZ)).toBe("domingo 4 de octubre");
  });

  test("sin fecha", () => {
    expect(eventDateText(null, true, TZ)).toBe("próximamente");
  });
});

describe("freeEventPresets — recordatorio", () => {
  const rec = byId(freeEventPresets(event, TZ), "recordatorio")!;

  test("entra con el enlace de Meet, no con la landing", () => {
    expect(rec.vars?.enlace).toBe(MEET);
    expect(rec.text).toContain(`Entra aquí: ${MEET}`);
    expect(rec.text).not.toContain("/eventos-gratuitos");
    expect(rec.label).toBe("Recordatorio con el enlace de Meet");
  });

  test("«evento» es el título entre comillas, sin el tipo de evento delante", () => {
    expect(rec.vars?.evento).toBe("«Sanar la relación con mamá»");
    expect(rec.text).toContain(
      "te recuerdo que «Sanar la relación con mamá» es el domingo 4 de octubre a las 9:30 a. m. Entra aquí"
    );
    expect(rec.text.toLowerCase()).not.toContain("webinar gratuito");
  });

  test("la fecha empieza por el día de la semana", () => {
    expect(rec.vars?.fecha).toMatch(/^domingo 4 de octubre a las 9:30 a\. m/);
  });

  test("la plantilla pone punto tras {{fecha}}: sin «a. m..»", () => {
    // Cuerpo aprobado: «… es el {{fecha}}. Entra aquí: {{enlace}} …».
    const rendered = `es el ${rec.vars?.fecha}. Entra aquí`;
    expect(rendered).toBe("es el domingo 4 de octubre a las 9:30 a. m. Entra aquí");
    expect(rec.text).not.toContain("..");
  });

  test("sin enlace de Meet todavía: la landing, y la etiqueta lo dice", () => {
    const noMeet = byId(freeEventPresets({ ...event, meetUrl: null }, TZ), "recordatorio")!;
    expect(noMeet.vars?.enlace).toBe(landing());
    expect(noMeet.label).toContain("sin enlace de Meet");
  });
});

describe("freeEventPresets — invitación y material", () => {
  test("la invitación sigue llevando a la landing aunque haya Meet", () => {
    const inv = byId(freeEventPresets(event, TZ), "invitacion")!;
    expect(inv.vars?.enlace).toBe(landing());
    expect(inv.vars?.evento).toBe("«Sanar la relación con mamá»");
    expect(inv.vars?.fecha).toMatch(/^domingo /);
    expect(inv.text).not.toContain(MEET);
  });

  test("material descargable: la descarga de la web", () => {
    const mat = byId(freeEventPresets({ ...event, materialDownloadable: true }, TZ), "material")!;
    expect(mat.vars?.enlace).toBe(`${getSiteUrl()}/api/webinar/material`);
  });

  test("material que la web ya no sirve: el enlace lo pega quien envía", () => {
    const mat = byId(freeEventPresets(event, TZ), "material")!;
    expect(mat.vars?.enlace).toBe(LINK_SLOT);
    expect(presetMissingLink(mat, mat.text)).toBe(true);
    const text = `${mat.text}https://youtu.be/grabacion.`;
    expect(presetMissingLink(mat, text)).toBe(false);
    expect(resolvePresetVars(mat.vars, text)?.enlace).toBe("https://youtu.be/grabacion");
  });
});

describe("freeEventPresetsFor — según el evento que se mira", () => {
  const past: FreeEventPresetEvent = {
    headline: "Evento de agosto",
    startsAt: new Date("2026-08-16T14:30:00Z"),
    startsAtHasTime: true,
    meetUrl: "https://meet.google.com/old-old-old",
  };
  const ids = (p: { id: string }[]) => p.map((x) => x.id);

  test("ninguno: invitación al evento abierto y mensaje libre", () => {
    const p = freeEventPresetsFor({ selected: null, selectedUpcoming: false, openEvent: event }, TZ);
    expect(ids(p)).toEqual(["invitacion", "libre"]);
    expect(p[0].vars?.evento).toBe("«Sanar la relación con mamá»");
  });

  test("ninguno y nada abierto: solo mensaje libre", () => {
    const p = freeEventPresetsFor({ selected: null, selectedUpcoming: false, openEvent: null }, TZ);
    expect(ids(p)).toEqual(["libre"]);
  });

  test("el actual: recordatorio con Meet, material y libre", () => {
    const p = freeEventPresetsFor({ selected: event, selectedUpcoming: true, openEvent: event }, TZ);
    expect(ids(p)).toEqual(["recordatorio", "material", "libre"]);
    expect(p[0].vars?.enlace).toBe(MEET);
  });

  test("recordatorio: la plantilla de utilidad si ya está aprobada, si no la de siempre; mismas variables", () => {
    const base = { selected: event, selectedUpcoming: true, openEvent: event };
    const old = freeEventPresetsFor(base, TZ)[0];
    expect(old.templateKey).toBe(EVENT_REMINDER_FALLBACK_TEMPLATE_KEY);
    const key = preferredEventReminderTemplateKey([
      { key: EVENT_REMINDER_UTILITY_TEMPLATE_KEY, metaApprovalStatus: "APPROVED", metaCategory: "UTILITY" },
    ]);
    const utility = freeEventPresetsFor({ ...base, reminderTemplateKey: key }, TZ)[0];
    expect(utility.templateKey).toBe(EVENT_REMINDER_UTILITY_TEMPLATE_KEY);
    expect(utility.vars).toEqual(old.vars);
    expect(byId(freeEventPresets(event, TZ, key), "recordatorio")?.templateKey).toBe(EVENT_REMINDER_UTILITY_TEMPLATE_KEY);
  });

  test("uno pasado: su material e invitación al actual", () => {
    const p = freeEventPresetsFor({ selected: past, selectedUpcoming: false, openEvent: event }, TZ);
    expect(ids(p)).toEqual(["material", "invitacion", "libre"]);
    expect(p[0].vars?.evento).toBe("el material de «Evento de agosto»");
    expect(p[0].vars?.enlace).toBe(LINK_SLOT);
    expect(p[1].label).toBe("Invitación al evento actual");
    expect(p[1].vars?.evento).toBe("«Sanar la relación con mamá»");
    expect(p[1].vars?.enlace).toBe(landing());
  });
});

describe("workshopPresets", () => {
  test("la fecha también empieza por el día de la semana", () => {
    const [inv] = workshopPresets(
      { title: "Niña interior", slug: "nina", startsAt: event.startsAt, dateLabel: null, meetingUrl: null },
      TZ
    );
    // Sin el punto final: la plantilla pone el suyo («el {{fecha}}. Toda…»).
    expect(inv.vars?.fecha).toBe("domingo 4 de octubre a las 9:30 a. m");
    expect(inv.text).toContain("a las 9:30 a. m. Toda la información");
  });
});
