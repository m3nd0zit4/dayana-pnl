import type { StaffRole } from "@prisma/client";
import {
  canBroadcastNotifications,
  canManageTeam,
  canRecordManualPayments,
  canWriteCrm,
} from "@/lib/crm/staff-permissions";
import { writeAuditLog } from "@/lib/crm/audit";
import { fireNotification } from "@/lib/notifications/platform/emit";

/**
 * The caller identity every tool call carries. The MCP server builds it from
 * the access token (`lib/mcp/server.ts`, `attributes.channel = "mcp"`); the
 * e2e scripts build it by hand for a dev staff user.
 */
export type AgentToolContext = {
  session: {
    auth?: { current?: { principalId: string; attributes?: Record<string, unknown> } | null };
  };
};

export class AgentPermissionError extends Error {}

/** The staff user the current turn is acting on behalf of — never trust tool input for this. */
export const getCallerStaff = (ctx: AgentToolContext): { staffId: string; role: StaffRole } => {
  const current = ctx.session.auth?.current;
  const role = current?.attributes?.role as StaffRole | undefined;
  if (!current || !role) {
    throw new AgentPermissionError(
      "No hay una sesión de staff válida asociada a esta conversación."
    );
  }
  return { staffId: current.principalId, role };
};

/**
 * Minimum bar for EVERY tool, including read-only ones: the call must run on
 * behalf of a real staff user. Without this, a caller with no staff identity
 * could read the whole CRM through the read tools.
 */
export const requireStaff = (ctx: AgentToolContext) => getCallerStaff(ctx);

/** Same write-role rule the CRM API routes already enforce — a tool can never exceed it. */
export const requireWriteStaff = (ctx: AgentToolContext) => {
  const staff = getCallerStaff(ctx);
  if (!canWriteCrm(staff.role)) {
    throw new AgentPermissionError("Tu rol (solo lectura) no permite modificar datos en el CRM.");
  }
  return staff;
};

/** Team management (create staff, change roles) is OWNER-only, same as the /admin/staff UI. */
export const requireManageTeam = (ctx: AgentToolContext) => {
  const staff = getCallerStaff(ctx);
  if (!canManageTeam(staff.role)) {
    throw new AgentPermissionError("Solo el OWNER puede gestionar el equipo.");
  }
  return staff;
};

/** Manual payment recording is gated the same way the /admin/payments manual-entry UI gates it. */
export const requireManualPaymentStaff = (ctx: AgentToolContext) => {
  const staff = getCallerStaff(ctx);
  if (!canRecordManualPayments(staff.role)) {
    throw new AgentPermissionError("Tu rol no permite registrar pagos manuales.");
  }
  return staff;
};

/** Bulk/campaign sends are gated the same way the /admin/messages broadcast route gates them. */
export const requireBroadcastStaff = (ctx: AgentToolContext) => {
  const staff = requireWriteStaff(ctx);
  if (!canBroadcastNotifications(staff.role)) {
    throw new AgentPermissionError(
      "Tu rol no permite lanzar envíos masivos. Solo el OWNER puede hacerlo."
    );
  }
  return staff;
};

/**
 * The audit row says which door a write came through: `MCP_*` plus the token
 * id for an external agent (the MCP server sets `attributes.channel = "mcp"`).
 * `AGENT_*` is what the panel assistant wrote until it was removed (2026-11);
 * today only a script calling a tool directly lands there.
 */
const callerChannel = (ctx: AgentToolContext) => {
  const attributes = ctx.session.auth?.current?.attributes;
  return attributes?.channel === "mcp"
    ? { prefix: "MCP", who: "Un agente externo (MCP)", tokenId: attributes.tokenId as string | undefined }
    : { prefix: "AGENT", who: "El asistente", tokenId: undefined };
};

export const auditAgentWrite = async (
  ctx: AgentToolContext,
  input: { action: string; entityType: string; entityId: string; changes?: unknown },
  options: { notify?: boolean } = {}
) => {
  const staff = getCallerStaff(ctx);
  const channel = callerChannel(ctx);
  await writeAuditLog({
    staffUserId: staff.staffId,
    action: `${channel.prefix}_${input.action}`,
    entityType: input.entityType,
    entityId: input.entityId,
    changes: channel.tokenId
      ? { ...(typeof input.changes === "object" && input.changes ? input.changes : { value: input.changes }), mcpTokenId: channel.tokenId }
      : input.changes,
  });

  if (options.notify === false) return;
  fireNotification({
    eventType: "AGENT_ACTION_EXECUTED",
    title: `${channel.who} ejecutó ${input.action} sobre ${input.entityType}`,
    body: `A nombre de un usuario con rol ${staff.role}.`,
    href: "/admin/audit",
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: { action: input.action, staffUserId: staff.staffId },
    staff: "ALL",
  });
};
