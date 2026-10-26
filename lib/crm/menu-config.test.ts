import { describe, expect, test } from "bun:test";

import {
  CRM_BOTTOM_TABS,
  crmHomeItem,
  crmMenuSections,
  crmStatsItem,
  crmWhatsAppItem,
  findMenuItem,
  type CrmMenuItem,
  type CrmMenuItemId,
} from "../../app/config/crm-menu-items";

/**
 * La configuración del menú es la única fuente de la barra lateral y de la
 * barra inferior del móvil. Estas pruebas fijan lo que se decidió con Dayana
 * (oct. 2026) para que un cambio suelto no lo deshaga sin que nadie se entere.
 */

const allItems = (): CrmMenuItem[] => {
  const top = [crmHomeItem, crmWhatsAppItem, ...crmMenuSections.flatMap((s) => s.items)];
  return top.flatMap((item) => [item, ...((item.items ?? []) as CrmMenuItem[])]);
};

describe("menú del CRM", () => {
  test("cada entrada tiene un id único", () => {
    const ids = allItems().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("cada entrada lleva a /admin", () => {
    for (const item of allItems()) expect(item.href.startsWith("/admin")).toBe(true);
  });

  test("dos entradas hoja no llevan al mismo sitio", () => {
    // Un padre con hijos comparte ruta con su primer hijo; las hojas, no.
    const leaves = allItems().filter((i) => !i.items || i.items.length === 0);
    const hrefs = leaves.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test("las secciones tienen id único", () => {
    const ids = crmMenuSections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("lo que se configura una vez vive en un grupo plegado", () => {
    const rarely = ["products", "promo-codes", "messages", "magnets", "content", "inbox"];
    for (const id of rarely) {
      const section = crmMenuSections.find((s) => s.items.some((i) => i.id === id));
      expect(section?.collapsible).toBe(true);
    }
  });

  test("lo de cada día queda a la vista", () => {
    const daily = ["contacts", "memberships", "diagnostics", "payments", "payment-links"];
    for (const id of daily) {
      const section = crmMenuSections.find((s) => s.items.some((i) => i.id === id));
      expect(section).toBeDefined();
      expect(section?.collapsible).toBeFalsy();
    }
  });

  test("el menú contiene exactamente estas entradas: nada se vuelve inalcanzable sin que se note", () => {
    // Si se quita o se renombra una entrada, esta lista tiene que cambiar a
    // propósito. `stats` es la única que existe en la configuración sin pintarse.
    const expected: CrmMenuItemId[] = [
      "home",
      "whatsapp",
      "contacts",
      "memberships",
      "diagnostics",
      "payments",
      "payment-links",
      "courses",
      "modules",
      "comments",
      "workshops",
      "free-events",
      "free-events-list",
      "free-events-people",
      "products",
      "promo-codes",
      "messages",
      "magnets",
      "content",
      "inbox",
    ];
    expect(allItems().map((i) => i.id).sort()).toEqual([...expected].sort());
  });

  test("Estadísticas no es una fila del menú, pero la entrada sigue existiendo", () => {
    expect(allItems().some((i) => i.id === "stats")).toBe(false);
    const stats = findMenuItem("stats");
    expect(stats).toBe(crmStatsItem);
    expect(stats?.href).toBe("/admin/estadisticas");
  });

  test("la barra inferior: Inicio, WhatsApp, Contactos y Pagos, y todas existen", () => {
    expect([...CRM_BOTTOM_TABS]).toEqual(["home", "whatsapp", "contacts", "payments"]);
    const hrefs = CRM_BOTTOM_TABS.map((id) => findMenuItem(id)?.href);
    for (const href of hrefs) expect(href).toBeDefined();
    expect(new Set(hrefs).size).toBe(CRM_BOTTOM_TABS.length);
  });

  test("ninguna entrada de la barra inferior es solo para la dueña ni depende de un interruptor", () => {
    // La barra inferior es igual para todo el equipo: un acceso que rebota o
    // desaparece en el teléfono es peor que no tenerlo.
    for (const id of CRM_BOTTOM_TABS) {
      const item = findMenuItem(id);
      expect(item?.ownerOnly).toBeFalsy();
      expect(item?.flag).toBeUndefined();
    }
  });

  test("las etiquetas de la barra inferior son cortas (caben en una celda de ~78 px)", () => {
    for (const id of CRM_BOTTOM_TABS) {
      const item = findMenuItem(id);
      const label = item?.shortLabel ?? item?.label ?? "";
      expect(label.length).toBeLessThanOrEqual(9);
    }
  });
});
