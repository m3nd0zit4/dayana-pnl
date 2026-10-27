import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  visibleWhatsAppMenu,
  whatsAppMenuItems,
  type WhatsAppMenuItem,
} from "../../app/config/whatsapp-menu-items";

/**
 * El menú de la sección de WhatsApp, fijado: qué filas hay, qué ve cada rol y
 * que ninguna pantalla se queda sin camino desde el menú.
 */

const owner = { isOwner: true, metaInboxEnabled: false } as const;
const ownerWithInbox = { isOwner: true, metaInboxEnabled: true } as const;
const staff = { isOwner: false, metaInboxEnabled: false } as const;

const flatten = (items: WhatsAppMenuItem[]): Omit<WhatsAppMenuItem, "items">[] =>
  items.flatMap((item) => [item, ...(item.items ?? [])]);

/** Las rutas estáticas de `app/admin/(panel)/whatsapp` (sin segmentos dinámicos). */
const whatsAppPageRoutes = (): string[] => {
  const root = join(process.cwd(), "app", "admin", "(panel)", "whatsapp");
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith("[")) continue; // detalle de algo que ya está en el menú
        walk(join(dir, entry.name), [...segments, entry.name]);
      } else if (entry.name === "page.tsx") {
        routes.push(["/admin/whatsapp", ...segments].join("/"));
      }
    }
  };
  walk(root, []);
  return routes;
};

describe("menú de WhatsApp: estructura", () => {
  test("ids únicos, padres e hijos", () => {
    const ids = flatten(whatsAppMenuItems).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("todo lleva a la sección de WhatsApp o a la bandeja de Meta", () => {
    for (const item of flatten(whatsAppMenuItems)) {
      expect(item.href === "/admin/inbox" || item.href.startsWith("/admin/whatsapp")).toBe(true);
    }
  });

  test("ninguna pantalla de WhatsApp se queda sin camino desde el menú", () => {
    const hrefs = new Set(flatten(whatsAppMenuItems).map((i) => i.href));
    for (const route of whatsAppPageRoutes()) {
      expect(hrefs.has(route)).toBe(true);
    }
  });

  test("Chats es la única fila de ruta exacta (es prefijo de todas las demás)", () => {
    const exact = flatten(whatsAppMenuItems).filter((i) => i.exact);
    expect(exact.map((i) => i.id)).toEqual(["chats"]);
  });

  test("los submenús agrupan lo que se decidió", () => {
    const children = (id: string) => whatsAppMenuItems.find((i) => i.id === id)?.items?.map((c) => c.id);
    expect(children("sends")).toEqual(["sends-history", "communities"]);
    expect(children("assistant")).toEqual(["status", "talk"]);
    expect(children("settings")).toEqual(["settings-general", "templates"]);
  });
});

describe("menú de WhatsApp: qué ve cada quien", () => {
  test("la dueña ve seis filas; con Instagram y Messenger activos, siete", () => {
    expect(visibleWhatsAppMenu(whatsAppMenuItems, owner).map((i) => i.id)).toEqual([
      "chats",
      "people",
      "agenda",
      "sends",
      "assistant",
      "settings",
    ]);
    expect(visibleWhatsAppMenu(whatsAppMenuItems, ownerWithInbox).map((i) => i.id)).toEqual([
      "chats",
      "people",
      "agenda",
      "social-inbox",
      "sends",
      "assistant",
      "settings",
    ]);
  });

  test("antes eran nueve filas sueltas: ahora hay menos filas a la vista", () => {
    expect(visibleWhatsAppMenu(whatsAppMenuItems, owner).length).toBeLessThan(9);
  });

  test("Instagram y Messenger solo aparece con su interruptor encendido", () => {
    expect(flatten(visibleWhatsAppMenu(whatsAppMenuItems, owner)).some((i) => i.id === "social-inbox")).toBe(false);
    expect(flatten(visibleWhatsAppMenu(whatsAppMenuItems, ownerWithInbox)).some((i) => i.id === "social-inbox")).toBe(true);
  });

  test("quien no es dueña no ve «Hablar con la IA» ni «Ajustes de WhatsApp»", () => {
    const ids = flatten(visibleWhatsAppMenu(whatsAppMenuItems, staff)).map((i) => i.id);
    expect(ids).not.toContain("talk");
    expect(ids).not.toContain("settings-general");
  });

  test("un submenú de una sola entrada pasa a ser esa entrada", () => {
    const rows = visibleWhatsAppMenu(whatsAppMenuItems, staff);
    // «Asistente IA» se queda solo con «Estado de la IA».
    const assistant = rows.find((r) => r.id === "status");
    expect(assistant?.label).toBe("Estado de la IA");
    expect(assistant?.href).toBe("/admin/whatsapp/estado");
    expect(assistant?.items).toBeUndefined();
    // «Ajustes» se queda solo con «Plantillas», que seguía siendo para todos.
    const templates = rows.find((r) => r.id === "templates");
    expect(templates?.label).toBe("Plantillas");
    expect(templates?.href).toBe("/admin/whatsapp/plantillas");
  });

  test("quien no es dueña conserva el acceso a todo lo que tenía antes", () => {
    const hrefs = flatten(visibleWhatsAppMenu(whatsAppMenuItems, staff)).map((i) => i.href);
    for (const href of [
      "/admin/whatsapp",
      "/admin/whatsapp/estado",
      "/admin/whatsapp/personas",
      "/admin/whatsapp/agenda",
      "/admin/whatsapp/envios",
      "/admin/whatsapp/comunidades",
      "/admin/whatsapp/plantillas",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  test("la dueña conserva el acceso a todo lo que tenía antes", () => {
    const hrefs = flatten(visibleWhatsAppMenu(whatsAppMenuItems, owner)).map((i) => i.href);
    for (const href of [
      "/admin/whatsapp",
      "/admin/whatsapp/estado",
      "/admin/whatsapp/personas",
      "/admin/whatsapp/agenda",
      "/admin/whatsapp/envios",
      "/admin/whatsapp/comunidades",
      "/admin/whatsapp/plantillas",
      "/admin/whatsapp/asistente",
      "/admin/whatsapp/ajustes",
    ]) {
      expect(hrefs).toContain(href);
    }
  });
});
