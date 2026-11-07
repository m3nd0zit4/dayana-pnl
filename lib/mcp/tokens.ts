import type { StaffRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/crm/audit";
import { effectiveScopes, normalizeScopes, roleScopes, scopesBeyondRole, type McpScope } from "./scopes";
import { OAUTH_GRANT_PREFIX } from "./oauth-format";
import {
  expiryFrom,
  generateMcpToken,
  hashMcpToken,
  looksLikeMcpToken,
  LAST_USED_THROTTLE_MS,
  tokenDisplayPrefix,
  tokenStatus,
  type ExpiryDays,
  type McpTokenStatus,
} from "./token-format";

/**
 * Tokens personales de acceso al servidor MCP (`/api/mcp`).
 *
 * El token en claro existe una sola vez: en la respuesta de `createMcpToken`.
 * En la base va su sha256, y en el registro de auditoría ni eso.
 */

/** Tope de tokens vivos por persona: suficientes para varios clientes, no para olvidarlos. */
export const MAX_ACTIVE_TOKENS_PER_STAFF = 20;

export class McpTokenError extends Error {
  constructor(
    readonly code: "no_access" | "invalid_name" | "invalid_scopes" | "scope_exceeds_role" | "too_many" | "not_found" | "forbidden",
    message: string
  ) {
    super(message);
  }
}

export type McpTokenView = {
  id: string;
  name: string;
  prefix: string;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: McpTokenStatus;
  staffUserId: string;
  ownerName: string;
  /** `token`: token personal pegado a mano; `oauth`: conexión autorizada al iniciar sesión (claude.ai…). */
  kind: "token" | "oauth";
  /** Solo OAuth: el cliente que pidió la conexión. */
  clientName: string | null;
};

type Viewer = { id: string; role: StaffRole };

const toView = (row: {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  staffUserId: string;
  staffUser: { displayName: string };
  oauthClientId: string | null;
  oauthClient: { name: string } | null;
}): McpTokenView => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  scopes: normalizeScopes(row.scopes),
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
  status: tokenStatus(row),
  staffUserId: row.staffUserId,
  ownerName: row.staffUser.displayName,
  kind: row.oauthClientId || row.prefix === OAUTH_GRANT_PREFIX ? "oauth" : "token",
  clientName: row.oauthClient?.name ?? null,
});

const VIEW_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  staffUserId: true,
  staffUser: { select: { displayName: true } },
  oauthClientId: true,
  oauthClient: { select: { name: true } },
} as const;

export const createMcpToken = async (input: {
  staff: Viewer;
  name: string;
  scopes: readonly unknown[];
  expiresInDays: ExpiryDays | null;
}): Promise<{ token: string; record: McpTokenView }> => {
  if (roleScopes(input.staff.role).length === 0) {
    throw new McpTokenError("no_access", "Tu rol no tiene acceso por MCP.");
  }
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new McpTokenError("invalid_name", "Ponle un nombre de 1 a 80 caracteres.");
  }
  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0 || scopes.length !== new Set(input.scopes).size) {
    throw new McpTokenError("invalid_scopes", "Elige al menos un permiso válido.");
  }
  const beyond = scopesBeyondRole(scopes, input.staff.role);
  if (beyond.length) {
    throw new McpTokenError("scope_exceeds_role", `Tu rol no permite: ${beyond.join(", ")}.`);
  }
  const now = new Date();
  const active = await prisma.mcpAccessToken.count({
    where: {
      staffUserId: input.staff.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  if (active >= MAX_ACTIVE_TOKENS_PER_STAFF) {
    throw new McpTokenError("too_many", `Ya tienes ${active} conexiones activas. Revoca alguna antes de crear otra.`);
  }

  const token = generateMcpToken();
  const row = await prisma.mcpAccessToken.create({
    data: {
      staffUserId: input.staff.id,
      name,
      tokenHash: hashMcpToken(token),
      prefix: tokenDisplayPrefix(token),
      scopes,
      expiresAt: expiryFrom(input.expiresInDays, now),
    },
    select: VIEW_SELECT,
  });
  await writeAuditLog({
    staffUserId: input.staff.id,
    action: "MCP_TOKEN_CREATED",
    entityType: "McpAccessToken",
    entityId: row.id,
    changes: { name, prefix: row.prefix, scopes, expiresAt: row.expiresAt?.toISOString() ?? null },
  });
  return { token, record: toView(row) };
};

/** Los tokens propios; el OWNER ve los de todo el equipo. Los revocados también (los 200 más recientes). */
export const listMcpTokens = async (viewer: Viewer): Promise<McpTokenView[]> => {
  const rows = await prisma.mcpAccessToken.findMany({
    where: viewer.role === "OWNER" ? {} : { staffUserId: viewer.id },
    orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 200,
    select: VIEW_SELECT,
  });
  return rows.map(toView);
};

/** Revoca un token propio (o cualquiera, si es el OWNER). Revocar dos veces no hace nada. */
export const revokeMcpToken = async (viewer: Viewer, id: string): Promise<McpTokenView> => {
  const row = await prisma.mcpAccessToken.findUnique({ where: { id }, select: VIEW_SELECT });
  if (!row) throw new McpTokenError("not_found", "Esa conexión no existe.");
  if (row.staffUserId !== viewer.id && viewer.role !== "OWNER") {
    throw new McpTokenError("forbidden", "Solo puedes revocar tus propias conexiones.");
  }
  if (row.revokedAt) return toView(row);

  const now = new Date();
  const updated = await prisma.mcpAccessToken.update({
    where: { id },
    data: { revokedAt: now },
    select: VIEW_SELECT,
  });
  // Conexión OAuth: sus tokens ya no valen (la verificación mira la conexión), pero quedan marcados.
  await prisma.mcpOAuthToken.updateMany({ where: { grantId: id, revokedAt: null }, data: { revokedAt: now } });
  await writeAuditLog({
    staffUserId: viewer.id,
    action: "MCP_TOKEN_REVOKED",
    entityType: "McpAccessToken",
    entityId: id,
    changes: {
      name: row.name,
      prefix: row.prefix,
      ownerStaffUserId: row.staffUserId,
      ...(row.oauthClientId ? { via: "oauth", oauthClientId: row.oauthClientId, reason: "manual" } : {}),
    },
  });
  return toView(updated);
};

export type McpCaller = {
  /** Id de la fila `McpAccessToken`: el token personal o la conexión OAuth. */
  tokenId: string;
  tokenName: string;
  staffId: string;
  staffName: string;
  role: StaffRole;
  /** token.scopes ∩ lo que permite el rol de HOY. Nunca vacío. */
  scopes: McpScope[];
  expiresAt: Date | null;
  /** Cómo entró: token personal o conexión OAuth (va en la auditoría). */
  via: "token" | "oauth";
};

/**
 * El token en claro → quién llama y qué puede hacer, o null.
 *
 * null si no tiene nuestra forma, no existe, está revocado o caducado, la
 * persona está desactivada, o su rol actual ya no le deja nada de lo que el
 * token tenía. No dice cuál de esas fue: a quien prueba tokens no le sirve saberlo.
 */
export const verifyMcpToken = async (raw: string | undefined | null, now = new Date()): Promise<McpCaller | null> => {
  if (!looksLikeMcpToken(raw)) return null;
  const row = await prisma.mcpAccessToken.findUnique({
    where: { tokenHash: hashMcpToken(raw) },
    select: {
      id: true,
      name: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      staffUser: { select: { id: true, displayName: true, role: true, isActive: true } },
    },
  });
  if (!row || tokenStatus(row, now) !== "active" || !row.staffUser.isActive) return null;
  const scopes = effectiveScopes(row.scopes, row.staffUser.role);
  if (scopes.length === 0) return null;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS) {
    // Condicional: de varias peticiones a la vez solo una escribe.
    await prisma.mcpAccessToken
      .updateMany({
        where: {
          id: row.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } }],
        },
        data: { lastUsedAt: now },
      })
      .catch(() => undefined);
  }

  return {
    tokenId: row.id,
    tokenName: row.name,
    staffId: row.staffUser.id,
    staffName: row.staffUser.displayName,
    role: row.staffUser.role,
    scopes,
    expiresAt: row.expiresAt,
    via: "token",
  };
};
