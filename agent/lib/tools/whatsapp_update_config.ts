import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { auditAgentWrite, requireManageTeam } from "@/agent/lib/guard";
import { applyConfigPatch, previewConfigPatch } from "@/lib/crm/whatsapp-agent/config-patch";

export default defineTool({
  description:
    "Change the WhatsApp AI's configuration. `patch` holds only the fields to change: objects are merged, lists are replaced whole (for example {booking:{services:[...]}} replaces every service). To change instructions or styleGuide send the full new text, keeping what was there. `enabled` turns the AI on or off. Read whatsapp_get_config first. Dayana approves before it applies.",
  inputSchema: z.object({
    summary: z.string().max(300).describe("Qué cambia, en una frase para Dayana."),
    patch: z.record(z.string(), z.unknown()).default({}),
    enabled: z.boolean().optional(),
  }),
  approval: always(),
  async execute({ summary, patch, enabled }, ctx) {
    requireManageTeam(ctx);
    const preview = await previewConfigPatch(patch);
    if (!preview.ok) throw new Error(`Cambio no válido: ${preview.error}`);
    const result = await applyConfigPatch(patch, enabled);
    if (!result.ok) throw new Error(result.error);
    await auditAgentWrite(ctx, {
      action: "WHATSAPP_AI_CONFIG_UPDATED",
      entityType: "WhatsAppAiConfig",
      entityId: "whatsapp.ai",
      changes: { summary, changed: result.changed, enabled },
    });
    return { ok: true, changed: result.changed, enabled: result.enabled };
  },
});
