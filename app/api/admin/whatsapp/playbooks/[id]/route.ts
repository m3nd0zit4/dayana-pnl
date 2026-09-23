import { NextResponse } from "next/server";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { prisma } from "@/lib/db";
import { playbookSchema, upsertPlaybook } from "@/lib/crm/whatsapp-agent/playbooks";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** Editar, aprobar (encender) o apagar un procedimiento. */
export const PATCH = withStaff<Params>("owner", async ({ req, staff, params }) => {
  const parsed = playbookSchema.partial().safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const current = await prisma.whatsAppPlaybook.findUnique({ where: { id: params.id } });
  if (!current) return apiError("not_found", 404);
  const row = await upsertPlaybook({
    id: params.id,
    name: (parsed.data.name ?? current.name).replace(/ \(propuesta\)$/, ""),
    trigger: parsed.data.trigger ?? current.trigger,
    steps: parsed.data.steps ?? current.steps,
    isEnabled: parsed.data.isEnabled,
  });
  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "WhatsAppPlaybook",
    entityId: row.id,
    changes: parsed.data,
  });
  return NextResponse.json({ item: row });
});

export const DELETE = withStaff<Params>("owner", async ({ staff, params }) => {
  await prisma.whatsAppPlaybook.deleteMany({ where: { id: params.id } });
  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "WhatsAppPlaybook",
    entityId: params.id,
  });
  return NextResponse.json({ ok: true });
});
