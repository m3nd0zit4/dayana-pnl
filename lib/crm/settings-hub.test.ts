import { describe, expect, test } from "bun:test";

import { settingsHubGroups, settingsNavGroups } from "../../app/config/settings-hub";
import { WHATSAPP_SETTINGS } from "./whatsapp-settings-registry";
import { searchSettingsHub } from "./settings-hub";

const owner = { isOwner: true } as const;
const staff = { isOwner: false } as const;
const find = (query: string, who: { isOwner: boolean } = owner) =>
  searchSettingsHub(settingsHubGroups, query, who);

describe("centro de ajustes: estructura", () => {
  test("ids de grupo y de entrada únicos", () => {
    const groupIds = settingsHubGroups.map((g) => g.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    const itemIds = settingsHubGroups.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(itemIds).size).toBe(itemIds.length);
  });

  test("todo lleva a una página del CRM", () => {
    for (const item of settingsHubGroups.flatMap((g) => g.items)) {
      expect(item.href.startsWith("/admin/")).toBe(true);
    }
  });

  test("cualquier rol ve «Mi cuenta»; el resto es del dueño", () => {
    const visibleToStaff = settingsHubGroups.filter((g) => !g.ownerOnly).map((g) => g.id);
    expect(visibleToStaff).toEqual(["cuenta"]);
  });

  test("el menú lateral no repite los atajos a secciones de otra página", () => {
    const hrefs = settingsNavGroups(true).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs.some((h) => h.includes("#"))).toBe(false);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    // La página de integraciones sigue teniendo su entrada en el menú.
    expect(hrefs).toContain("/admin/ajustes/integraciones");
  });

  test("quien no es dueño solo ve «Mi cuenta» en el menú lateral", () => {
    const groups = settingsNavGroups(false);
    expect(groups.map((g) => g.label)).toEqual(["Mi cuenta"]);
  });

  test("las páginas que ya existían en Ajustes siguen alcanzables", () => {
    const hrefs = settingsNavGroups(true).flatMap((g) => g.items.map((i) => i.href));
    for (const href of [
      "/admin/ajustes/perfil",
      "/admin/ajustes/seguridad",
      "/admin/ajustes/mis-notificaciones",
      "/admin/ajustes/general",
      "/admin/ajustes/notificaciones",
      "/admin/ajustes/integraciones",
      "/admin/ajustes/canales",
      "/admin/ajustes/registro",
      "/admin/whatsapp/ajustes",
      "/admin/team",
      "/admin/audit",
    ]) {
      expect(hrefs).toContain(href);
    }
  });
});

describe("centro de ajustes: buscador", () => {
  test("vacío o solo espacios no devuelve nada", () => {
    expect(find("")).toEqual([]);
    expect(find("   ")).toEqual([]);
  });

  test("encuentra la página por lo que se cambia ahí", () => {
    expect(find("zona horaria")[0]?.href).toBe("/admin/ajustes/general");
    expect(find("paypal")[0]?.href).toBe("/admin/ajustes/integraciones#pagos");
    expect(find("contraseña")[0]?.href).toBe("/admin/ajustes/seguridad");
    expect(find("buzón de alertas")[0]?.href).toBe("/admin/ajustes/notificaciones");
    expect(find("roles")[0]?.href).toBe("/admin/team");
    expect(find("tiktok")[0]?.href).toBe("/admin/ajustes/integraciones#redes-sociales");
  });

  test("no distingue tildes ni mayúsculas", () => {
    expect(find("CONTRASEÑA")[0]?.href).toBe("/admin/ajustes/seguridad");
    expect(find("contrasena")[0]?.href).toBe("/admin/ajustes/seguridad");
    expect(find("Buzon")[0]?.href).toBe("/admin/ajustes/notificaciones");
  });

  test("lo que coincide en la etiqueta va primero", () => {
    const hits = find("google");
    expect(hits[0]?.label).toContain("Google");
  });

  test("encuentra también los ajustes sueltos de WhatsApp, con su pestaña y su id", () => {
    const entry = WHATSAPP_SETTINGS.find((e) => e.tab === "citas");
    expect(entry).toBeDefined();
    const hits = find(entry!.label);
    const wa = hits.find((h) => h.id === entry!.id);
    expect(wa).toBeDefined();
    expect(wa!.href).toBe(`/admin/whatsapp/ajustes?tab=${entry!.tab}&ajuste=${entry!.id}`);
    expect(wa!.where.startsWith("WhatsApp e IA")).toBe(true);
  });

  test("quien no es dueño no ve resultados de dueño ni de WhatsApp", () => {
    expect(find("zona horaria", staff)).toEqual([]);
    expect(find("paypal", staff)).toEqual([]);
    expect(find("roles", staff)).toEqual([]);
    const entry = WHATSAPP_SETTINGS[0];
    expect(find(entry.label, staff).some((h) => h.href.startsWith("/admin/whatsapp"))).toBe(false);
    // Pero sí lo suyo.
    expect(find("contraseña", staff)[0]?.href).toBe("/admin/ajustes/seguridad");
  });

  test("palabra sin coincidencias: nada", () => {
    expect(find("xyzzy-no-existe")).toEqual([]);
  });

  test("respeta el límite", () => {
    expect(searchSettingsHub(settingsHubGroups, "a", { isOwner: true, limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  test("todas las palabras tienen que coincidir", () => {
    // «paypal» está en Pagos; «contraseña» no: juntas no coinciden con nada.
    expect(find("paypal contraseña")).toEqual([]);
  });
});
