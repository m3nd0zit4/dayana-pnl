import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { auditAgentWrite, requireManageTeam } from "@/agent/lib/guard";
import { upsertPlaybook } from "@/lib/crm/whatsapp-agent/playbooks";
import { prisma } from "@/lib/db";

export default defineTool({
  description:
    "Create a WhatsApp AI playbook, edit one (with its id), approve a learned proposal (isEnabled=true) or delete one (delete=true). A rule about how to handle a situation (for example: when they ask the price, first ask what they are going through) is usually a playbook. Dayana approves before it applies.",
  inputSchema: z.object({
    id: z.string().optional(),
    name: z.string().trim().min(2).max(80),
    trigger: z.string().trim().min(3).max(500).describe("Cuándo aplica."),
    steps: z.string().trim().min(3).max(3000).describe("Qué hacer y qué no."),
    isEnabled: z.boolean().optional(),
    delete: z.boolean().optional(),
  }),
  approval: always(),
  async execute({ id, delete: remove, ...input }, ctx) {
    requireManageTeam(ctx);
    if (remove) {
      if (!id) throw new Error("Falta el id del procedimiento a borrar.");
      await prisma.whatsAppPlaybook.deleteMany({ where: { id } });
      await auditAgentWrite(ctx, {
        action: "WHATSAPP_PLAYBOOK_DELETED",
        entityType: "WhatsAppPlaybook",
        entityId: id,
      });
      return { ok: true, deleted: id };
    }
    const row = await upsertPlaybook({
      id,
      ...input,
      name: input.name.replace(/ \(propuesta\)$/, ""),
      isEnabled: input.isEnabled ?? true,
      source: "manual",
    });
    await auditAgentWrite(ctx, {
      action: id ? "WHATSAPP_PLAYBOOK_UPDATED" : "WHATSAPP_PLAYBOOK_CREATED",
      entityType: "WhatsAppPlaybook",
      entityId: row.id,
      changes: { name: row.name, isEnabled: row.isEnabled },
    });
    return { ok: true, id: row.id, name: row.name, isEnabled: row.isEnabled };
  },
});
