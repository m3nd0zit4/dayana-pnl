import type { StaffRole } from "@prisma/client";
import { TOOL_CATALOG, type ToolAccess, type ToolName } from "@/lib/crm-tools/catalog";

/**
 * Qué puede hacer un token MCP. Puro (sin Prisma ni red) para probarlo con
 * `bun test` y para que la pantalla de ajustes lo importe tal cual.
 *
 * Un scope por nivel de acceso del catálogo (`TOOL_CATALOG[name].access`):
 * `read` mira, `edit` cambia datos que solo ve el equipo, `execute` sale del
 * CRM o mueve dinero. Son conjuntos, no escalones: un token con `edit` y sin
 * `read` ve solo las herramientas de edición.
 */

export type McpScope = ToolAccess;

export const MCP_SCOPES: readonly McpScope[] = ["read", "edit", "execute"] as const;

/**
 * Lo máximo que puede tener cada rol (decisión de la dueña). DEVELOPER no
 * tiene acceso por MCP aunque pueda escribir en el panel: es una cuenta
 * técnica, no alguien que opere el CRM.
 */
export const ROLE_SCOPES: Record<StaffRole, readonly McpScope[]> = {
  OWNER: ["read", "edit", "execute"],
  OPERATOR: ["read", "edit"],
  READONLY: ["read"],
  DEVELOPER: [],
};

export const SCOPE_LABELS: Record<McpScope, { label: string; description: string }> = {
  read: { label: "Leer", description: "Consultar contactos, pagos, chats, talleres y estadísticas." },
  edit: { label: "Editar", description: "Cambiar datos del CRM que solo ve el equipo (contactos, borradores, talleres)." },
  execute: {
    label: "Ejecutar",
    description: "Lo que sale del CRM o mueve dinero: WhatsApp, correos, SMS, pagos manuales, precios.",
  },
};

export const isMcpScope = (value: unknown): value is McpScope =>
  typeof value === "string" && (MCP_SCOPES as readonly string[]).includes(value);

/** Sin repetidos, sin valores desconocidos y en el orden canónico. */
export const normalizeScopes = (values: readonly unknown[]): McpScope[] =>
  MCP_SCOPES.filter((scope) => values.includes(scope));

export const roleScopes = (role: StaffRole): McpScope[] => [...(ROLE_SCOPES[role] ?? [])];

/** `a ∩ b`, en orden canónico. */
export const intersectScopes = (a: readonly unknown[], b: readonly unknown[]): McpScope[] =>
  normalizeScopes(a).filter((scope) => b.includes(scope));

/** Los scopes pedidos que el rol no permite (vacío = se puede crear). */
export const scopesBeyondRole = (requested: readonly unknown[], role: StaffRole): McpScope[] => {
  const allowed = ROLE_SCOPES[role] ?? [];
  return normalizeScopes(requested).filter((scope) => !allowed.includes(scope));
};

/**
 * Lo que vale un token EN ESTE MOMENTO: lo que se le dio al crearlo, recortado
 * por el rol que la persona tiene hoy. Se recalcula en cada petición, así que
 * bajar de rol a alguien le quita el acceso al instante sin tocar sus tokens.
 */
export const effectiveScopes = (tokenScopes: readonly unknown[], currentRole: StaffRole): McpScope[] =>
  intersectScopes(tokenScopes, ROLE_SCOPES[currentRole] ?? []);

export const toolAccess = (name: ToolName): McpScope => TOOL_CATALOG[name].access;

export const canUseTool = (name: string, scopes: readonly McpScope[]): name is ToolName =>
  Object.prototype.hasOwnProperty.call(TOOL_CATALOG, name) &&
  scopes.includes(TOOL_CATALOG[name as ToolName].access);

/** Las herramientas que `tools/list` enseña con estos scopes. Las demás ni aparecen. */
export const visibleTools = (scopes: readonly McpScope[]): ToolName[] =>
  (Object.keys(TOOL_CATALOG) as ToolName[]).filter((name) => scopes.includes(TOOL_CATALOG[name].access));
