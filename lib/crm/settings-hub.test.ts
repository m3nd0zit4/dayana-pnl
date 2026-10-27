import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { settingsHubGroups, settingsNavGroups } from "../../app/config/settings-hub";
import { WHATSAPP_SETTINGS } from "./whatsapp-settings-registry";
import { hubCardGroups, searchSettingsHub, type SettingsHubGroup } from "./settings-hub";

const owner = { isOwner: true } as const;
const staff = { isOwner: false } as const;
const find = (query: string, who: { isOwner: boolean } = owner) =>
  searchSettingsHub(settingsHubGroups, query, who);

/** El archivo de la página a la que lleva un enlace de `/admin/...`. */
const pageFileFor = (href: string): string => {
  const path = href.split("#")[0].split("?")[0].replace(/^\/admin\//, "");
  return join(process.cwd(), "app", "admin", "(panel)", ...path.split("/"), "page.tsx");
};

describe("centro de ajustes: estructura", () => {
  test("ids de grupo y de entrada únicos", () => {
    const groupIds = settingsHubGroups.map((g) => g.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    const itemIds = settingsHubGroups.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(itemIds).size).toBe(itemIds.length);
  });

  test("cada enlace lleva a una página que existe, y cada ancla existe en ella", () => {
    for (const item of settingsHubGroups.flatMap((g) => g.items)) {
      expect(item.href.startsWith("/admin/")).toBe(true);
      const file = pageFileFor(item.href);
      expect(existsSync(file)).toBe(true);
      const anchor = item.href.split("#")[1];
      if (anchor) {
        expect(readFileSync(file, "utf8")).toContain(`id="${anchor}"`);
      }
    }
  });

  test("cualquier rol ve «Mi cuenta» y lo que solo se busca; el resto es del dueño", () => {
    const visibleToStaff = settingsHubGroups.filter((g) => !g.ownerOnly).map((g) => g.id);
    expect(visibleToStaff).toEqual(["cuenta", "en-su-pantalla"]);
  });

  test("los grupos «solo búsqueda» no tienen tarjeta ni salen en el menú lateral", () => {
    const searchOnly = settingsHubGroups.filter((g) => g.searchOnly);
    expect(searchOnly.length).toBeGreaterThan(0);
    const cardIds = hubCardGroups(settingsHubGroups).map((g) => g.id);
    const navLabels = settingsNavGroups(true).map((g) => g.label);
    for (const group of searchOnly) {
      expect(cardIds).not.toContain(group.id);
      expect(navLabels).not.toContain(group.title);
    }
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
  test("vacío, solo espacios o una sola letra no devuelven nada", () => {
    expect(find("")).toEqual([]);
    expect(find("   ")).toEqual([]);
    expect(find("a")).toEqual([]);
    expect(find("?")).toEqual([]);
  });

  test("encuentra la página por lo que se cambia ahí", () => {
    expect(find("zona horaria")[0]?.href).toBe("/admin/ajustes/general");
    expect(find("paypal")[0]?.href).toBe("/admin/ajustes/integraciones#pagos");
    expect(find("contraseña")[0]?.href).toBe("/admin/ajustes/seguridad");
    expect(find("buzón de alertas")[0]?.href).toBe("/admin/ajustes/notificaciones");
    expect(find("roles")[0]?.href).toBe("/admin/team");
    expect(find("tiktok")[0]?.href).toBe("/admin/ajustes/integraciones#redes-sociales");
  });

  test("no distingue tildes, mayúsculas ni signos", () => {
    expect(find("CONTRASEÑA")[0]?.href).toBe("/admin/ajustes/seguridad");
    expect(find("contrasena")[0]?.href).toBe("/admin/ajustes/seguridad");
    expect(find("Buzon")[0]?.href).toBe("/admin/ajustes/notificaciones");
    expect(find("contraseña?")[0]?.href).toBe("/admin/ajustes/seguridad");
    expect(find("¿zona horaria?")[0]?.href).toBe("/admin/ajustes/general");
  });

  test("encuentra lo que se cambia en su propia pantalla", () => {
    expect(find("mensajes rápidos")[0]?.href).toBe("/admin/messages");
    expect(find("precios")[0]?.href).toBe("/admin/products");
    expect(find("descuento")[0]?.href).toBe("/admin/promo-codes");
  });

  test("lo que coincide en la etiqueta va antes que lo que solo coincide en la pista", () => {
    const groups: SettingsHubGroup[] = [
      {
        id: "a",
        title: "A",
        purpose: "",
        items: [
          { id: "solo-pista", label: "Otra cosa", hint: "aquí se cambian los horarios", href: "/admin/a", keywords: [] },
        ],
      },
      {
        id: "b",
        title: "B",
        purpose: "",
        items: [{ id: "en-etiqueta", label: "Horarios", href: "/admin/b", keywords: [] }],
      },
    ];
    // Sin ser dueño no entran los ajustes de WhatsApp: la comparación es exacta.
    const hits = searchSettingsHub(groups, "horarios", { isOwner: false });
    expect(hits.map((h) => h.id)).toEqual(["en-etiqueta", "solo-pista"]);
  });

  test("a igualdad de etiqueta, la página va antes que el ajuste suelto de WhatsApp", () => {
    const groups: SettingsHubGroup[] = [
      {
        id: "a",
        title: "A",
        purpose: "",
        items: [{ id: "pagina", label: WHATSAPP_SETTINGS[0].label, href: "/admin/a", keywords: [] }],
      },
    ];
    const hits = searchSettingsHub(groups, WHATSAPP_SETTINGS[0].label, { isOwner: true });
    expect(hits[0]?.id).toBe("pagina");
    expect(hits.some((h) => h.id === WHATSAPP_SETTINGS[0].id)).toBe(true);
  });

  test("«citas» y «horarios» llevan a un ajuste concreto de WhatsApp, no a la página general", () => {
    // Enter abre el primer resultado: tiene que ser el ajuste, no «Asistente de WhatsApp».
    expect(find("citas")[0]?.href.startsWith("/admin/whatsapp/ajustes?tab=citas&ajuste=")).toBe(true);
    const horarios = find("horarios")[0];
    expect(horarios?.href.startsWith("/admin/whatsapp/ajustes?tab=")).toBe(true);
    expect(horarios?.href).toContain("&ajuste=");
  });

  test("«plantillas» lleva a la página de plantillas de WhatsApp", () => {
    expect(find("plantillas")[0]?.href).toBe("/admin/whatsapp/plantillas");
  });

  test("encuentra los ajustes sueltos de WhatsApp, con su pestaña y su id", () => {
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
    // Pero sí lo suyo y lo que se cambia en su pantalla.
    expect(find("contraseña", staff)[0]?.href).toBe("/admin/ajustes/seguridad");
    expect(find("mensajes rápidos", staff)[0]?.href).toBe("/admin/messages");
  });

  test("palabra sin coincidencias: nada", () => {
    expect(find("xyzzy-no-existe")).toEqual([]);
  });

  test("respeta el límite", () => {
    expect(searchSettingsHub(settingsHubGroups, "en", { isOwner: true, limit: 3 })).toHaveLength(3);
  });

  test("todas las palabras tienen que coincidir", () => {
    // «paypal» está en Pagos; «contraseña» no: juntas no coinciden con nada.
    expect(find("paypal contraseña")).toEqual([]);
  });
});
