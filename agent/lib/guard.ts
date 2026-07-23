import type { StaffRole } from "@prisma/client";
import { canWriteCrm } from "@/lib/crm/staff-permissions";
import { writeAuditLog } from "@/lib/crm/audit";

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

/** Same write-role rule the CRM API routes already enforce — the agent can never exceed it. */
export const requireWriteStaff = (ctx: AgentToolContext) => {
  const staff = getCallerStaff(ctx);
  if (!canWriteCrm(staff.role)) {
    throw new AgentPermissionError("Tu rol (solo lectura) no permite modificar datos en el CRM.");
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
};
