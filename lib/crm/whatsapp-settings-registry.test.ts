import { describe, expect, test } from "bun:test";

import {
  WHATSAPP_SETTINGS,
  WHATSAPP_SETTINGS_TABS,
  isWhatsAppSettingsTab,
  normalizeSearch,
  searchWhatsAppSettings,
} from "./whatsapp-settings-registry";

const ids = (q: string) => searchWhatsAppSettings(q).map((e) => e.id);

describe("normalizeSearch", () => {
  test("quita tildes, mayúsculas y espacios de más", () => {
    expect(normalizeSearch("  Antelación   MÍNIMA ")).toBe("antelacion minima");
  });
});

describe("searchWhatsAppSettings", () => {
  test("vacío no devuelve nada", () => {
    expect(searchWhatsAppSettings("")).toEqual([]);
    expect(searchWhatsAppSettings("   ")).toEqual([]);
  });

  test("«citas» encuentra los ajustes de agenda", () => {
    const found = searchWhatsAppSettings("citas");
    expect(found.length).toBeGreaterThan(3);
    expect(found.map((e) => e.id)).toContain("wa-booking-enabled");
    expect(found.map((e) => e.id)).toContain("wa-booking-services");
    expect(found.every((e) => e.tab === "citas")).toBe(true);
  });

  test("«horario» encuentra cuándo responde", () => {
    expect(ids("horario")).toContain("wa-schedule");
    expect(ids("horario")).toContain("wa-booking-hours");
  });

  test("no le importan las tildes ni las mayúsculas", () => {
    expect(ids("ANTELACION")).toContain("wa-booking-notice");
    expect(ids("autoevaluacion")).toContain("wa-outreach");
    expect(ids("días")).toEqual(ids("dias"));
  });

  test("singular y plural dan lo mismo", () => {
    expect(ids("cita")).toEqual(ids("citas"));
  });

  test("todas las palabras deben coincidir", () => {
    expect(ids("google meet")).toEqual(["wa-booking-meet"]);
    expect(ids("xyzzy")).toEqual([]);
  });

  test("las coincidencias en la etiqueta van primero", () => {
    expect(ids("bienvenida")[0]).toBe("wa-welcome");
    expect(ids("plantillas")[0]).toBe("wa-templates");
  });
});

describe("registro", () => {
  test("ids únicos y pestañas válidas", () => {
    const all = WHATSAPP_SETTINGS.map((e) => e.id);
    expect(new Set(all).size).toBe(all.length);
    expect(WHATSAPP_SETTINGS.every((e) => isWhatsAppSettingsTab(e.tab))).toBe(true);
  });

  test("cada pestaña tiene al menos un ajuste", () => {
    for (const tab of WHATSAPP_SETTINGS_TABS) {
      expect(WHATSAPP_SETTINGS.some((e) => e.tab === tab.id)).toBe(true);
    }
  });
});
