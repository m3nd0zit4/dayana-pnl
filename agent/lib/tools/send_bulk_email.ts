import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { isDryRun, isNotificationsEnabled } from "@/lib/notifications/config";
import {
  BROADCAST_SYNC_MAX_CONTACTS,
  createBroadcastCampaign,
  runBroadcastCampaign,
} from "@/lib/notifications/campaigns";
import { emitCampaignRun } from "@/lib/inngest/events";
import { isInngestConfigured } from "@/lib/inngest/config";
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";
import { isAgentSendableTemplate } from "@/lib/crm/quick-message-templates";
import { requireBroadcastStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Launch a bulk email campaign to MANY contacts at once, using an existing message template (see list_message_templates). This is irreversible once launched and can reach the entire contact list — always confirm the audience and template with the operator before calling it, and prefer `MARKETING_CONSENT` unless they explicitly ask for `ALL` contacts. System/transactional templates are rejected. Only OWNER-role staff can trigger this. The result includes a `dryRun` flag: when true nothing actually left the server.",
  inputSchema: z.object({
    name: z.string().trim().min(3).max(100).describe("Internal campaign name, for the operator's records."),
    templateKey: z.string().min(1).describe("Una clave de list_message_templates."),
    audience: z.enum(["ALL_CONTACTS", "MARKETING_CONSENT"]),
  }),
  approval: always(),
  async execute({ name, templateKey, audience }, ctx) {
    requireBroadcastStaff(ctx);

    if (!isAgentSendableTemplate(templateKey)) {
      throw new Error(
        "Esa plantilla es transaccional: nunca se manda como campaña masiva."
      );
    }

    if (!isNotificationsEnabled()) {
      throw new Error(
        "Los envíos están desactivados (NOTIFICATIONS_ENABLED). Actívalo en /admin/ajustes/integraciones."
      );
    }

    const { campaign, contactCount } = await createBroadcastCampaign({
      name,
      templateKey,
      channels: ["EMAIL"] as const,
      audience,
    });

    if (contactCount === 0) {
      throw new Error("Esa audiencia no tiene contactos con correo registrado.");
    }

    const inngestConfigured = isInngestConfigured();
    let queued = false;

    if (inngestConfigured) {
      await emitCampaignRun(campaign.id);
      queued = true;
    } else if (contactCount > BROADCAST_SYNC_MAX_CONTACTS) {
      throw new Error(
        `Más de ${BROADCAST_SYNC_MAX_CONTACTS} contactos requiere Inngest configurado ` +
          "(INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY). La campaña quedó creada pero sin lanzar."
      );
    } else {
      await runBroadcastCampaign(campaign.id);
    }

    await auditAgentWrite(ctx, {
      action: "SEND_BULK_EMAIL",
      entityType: "NotificationCampaign",
      entityId: campaign.id,
      changes: { audience, templateKey, contactCount },
    });

    await emitPlatformNotification({
      eventType: "AGENT_ACTION_EXECUTED",
      title: "El asistente lanzó una campaña de correo masivo",
      body: `"${name}" — ${contactCount} contactos (${audience})`,
      href: "/admin/messages",
      entityType: "NotificationCampaign",
      entityId: campaign.id,
      staff: "ALL",
    });

    return {
      campaignId: campaign.id,
      contactCount,
      queued,
      dryRun: isDryRun(),
    };
  },
});
