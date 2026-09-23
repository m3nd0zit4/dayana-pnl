import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "@/lib/crm/whatsapp-autoreply";
import { applyConfigPatch } from "@/lib/crm/whatsapp-agent/config-patch";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () =>
  NextResponse.json({
    config: await getWhatsAppAiConfig(),
    enabled: await isWhatsAppAutoReplyEnabled(),
  })
);

const patchSchema = z.object({
  patch: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().optional(),
});

/** Cambio parcial (lo usan Agenda y el chat con el asistente al aplicar). */
export const PATCH = withStaff("owner", async ({ req, staff }) => {
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const result = await applyConfigPatch(parsed.data.patch, parsed.data.enabled);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "WhatsAppAiConfig",
    entityId: "whatsapp.ai",
    changes: { changed: result.changed, enabled: parsed.data.enabled },
  });
  return NextResponse.json(result);
});
