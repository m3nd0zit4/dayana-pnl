import type { StaffRole } from "@prisma/client";
import { canManageTeam, canRecordManualPayments, canWriteCrm } from "@/lib/crm/staff-permissions";
import { writeAuditLog } from "@/lib/crm/audit";
import { fireNotification } from "@/lib/notifications/platform/emit";

/**
 * Shape of the caller identity eve threads onto every tool call, set by
 * `agent/channels/eve.ts`'s auth function. Kept loose/local (rather than
 * imported from `eve/tools`) since only `session.auth.current.attributes`
 * is used here.
 */
type AgentToolContext = {
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
 * Minimum bar for EVERY tool, including read-only ones: the turn must be
 * running on behalf of a real staff user. Without this, any principal that
 * reaches the channel (a `local-dev` fallback, a future non-staff
 * authenticator) could read the whole CRM through the read tools, since only
 * the write tools used to check the caller at all.
 */
export const requireStaff = (ctx: AgentToolContext) => getCallerStaff(ctx);

/** Same write-role rule the CRM API routes already enforce — the agent can never exceed it. */
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

export const auditAgentWrite = async (
  ctx: AgentToolContext,
  input: { action: string; entityType: string; entityId: string; changes?: unknown }
) => {
  const staff = getCallerStaff(ctx);
  await writeAuditLog({
    staffUserId: staff.staffId,
    action: `AGENT_${input.action}`,
    entityType: input.entityType,
    entityId: input.entityId,
    changes: input.changes,
  });

  fireNotification({
    eventType: "AGENT_ACTION_EXECUTED",
    title: `El asistente ejecutó ${input.action} sobre ${input.entityType}`,
    body: `A nombre de un usuario con rol ${staff.role}.`,
    href: "/admin/audit",
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: { action: input.action, staffUserId: staff.staffId },
    staff: "ALL",
  });
};
