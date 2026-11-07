import { describe, expect, test } from "bun:test";
import { TOOL_CATALOG, type ToolName } from "@/agent/lib/catalog";
import {
  canUseTool,
  effectiveScopes,
  intersectScopes,
  isMcpScope,
  normalizeScopes,
  roleScopes,
  scopesBeyondRole,
  visibleTools,
} from "./scopes";

const names = Object.keys(TOOL_CATALOG) as ToolName[];
const byAccess = (access: string) => names.filter((n) => TOOL_CATALOG[n].access === access);

describe("roleScopes", () => {
  test("jerarquía de la dueña", () => {
    expect(roleScopes("OWNER")).toEqual(["read", "edit", "execute"]);
    expect(roleScopes("OPERATOR")).toEqual(["read", "edit"]);
    expect(roleScopes("READONLY")).toEqual(["read"]);
    expect(roleScopes("DEVELOPER")).toEqual([]);
  });

  test("devuelve una copia", () => {
    const scopes = roleScopes("OWNER");
    scopes.pop();
    expect(roleScopes("OWNER")).toHaveLength(3);
  });
});

describe("normalize / intersect", () => {
  test("quita desconocidos y repetidos, orden canónico", () => {
    expect(normalizeScopes(["execute", "read", "read", "admin", 3, null])).toEqual(["read", "execute"]);
    expect(isMcpScope("edit")).toBe(true);
    expect(isMcpScope("EDIT")).toBe(false);
  });

  test("intersección", () => {
    expect(intersectScopes(["read", "edit", "execute"], ["edit", "read"])).toEqual(["read", "edit"]);
    expect(intersectScopes(["execute"], ["read"])).toEqual([]);
  });
});

describe("scopesBeyondRole", () => {
  test("lo que el rol no permite", () => {
    expect(scopesBeyondRole(["read", "edit", "execute"], "OPERATOR")).toEqual(["execute"]);
    expect(scopesBeyondRole(["read"], "READONLY")).toEqual([]);
    expect(scopesBeyondRole(["read"], "DEVELOPER")).toEqual(["read"]);
    expect(scopesBeyondRole(["execute"], "OWNER")).toEqual([]);
  });
});

describe("effectiveScopes (se recalcula con el rol de hoy)", () => {
  test("un OWNER degradado a READONLY pierde edit y execute", () => {
    expect(effectiveScopes(["read", "edit", "execute"], "READONLY")).toEqual(["read"]);
  });
  test("un token de solo execute de alguien que ya es OPERATOR no vale nada", () => {
    expect(effectiveScopes(["execute"], "OPERATOR")).toEqual([]);
  });
  test("DEVELOPER nunca tiene nada", () => {
    expect(effectiveScopes(["read", "edit", "execute"], "DEVELOPER")).toEqual([]);
  });
  test("un rol nunca gana lo que el token no tenía", () => {
    expect(effectiveScopes(["read"], "OWNER")).toEqual(["read"]);
  });
});

describe("visibilidad de herramientas", () => {
  test("read ve solo lecturas", () => {
    const visible = visibleTools(["read"]);
    expect(visible.length).toBe(byAccess("read").length);
    expect(visible.every((n) => TOOL_CATALOG[n].access === "read")).toBe(true);
    expect(visible).toContain("crm_stats");
    expect(visible).toContain("search_contacts");
    expect(visible).not.toContain("create_contact");
    expect(visible).not.toContain("send_whatsapp_to_contact");
  });

  test("todos los scopes = todo el catálogo menos la memoria del asistente", () => {
    const all = visibleTools(["read", "edit", "execute"]);
    expect(all).toHaveLength(names.length - 1);
    expect(all).not.toContain("memory");
  });

  test("sin scopes, nada", () => {
    expect(visibleTools([])).toEqual([]);
  });

  test("canUseTool", () => {
    expect(canUseTool("crm_stats", ["read"])).toBe(true);
    expect(canUseTool("create_contact", ["read"])).toBe(false);
    expect(canUseTool("record_manual_payment", ["read", "edit"])).toBe(false);
    expect(canUseTool("record_manual_payment", ["execute"])).toBe(true);
    expect(canUseTool("no_existe", ["read", "edit", "execute"])).toBe(false);
    expect(canUseTool("toString", ["read", "edit", "execute"])).toBe(false);
  });

  test("las herramientas nuevas de lectura son read", () => {
    for (const name of [
      "list_workshop_enrollees",
      "list_free_event_registrations",
      "list_whatsapp_messages",
      "list_payment_receipts",
      "list_ai_runs",
      "list_appointments",
      "list_notifications",
      "get_payment",
    ] as ToolName[]) {
      expect(TOOL_CATALOG[name].access).toBe("read");
    }
  });

  test("lo que llega a personas o mueve dinero es execute", () => {
    for (const name of byAccess("read").concat(byAccess("edit"))) {
      expect(name.startsWith("send_")).toBe(false);
    }
    expect(TOOL_CATALOG.record_manual_payment.access).toBe("execute");
    expect(TOOL_CATALOG.request_payment_otp.access).toBe("execute");
  });
});
