import { NextResponse } from "next/server";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  listPlaybooks,
  playbookSchema,
  seedDefaultPlaybooks,
  upsertPlaybook,
} from "@/lib/crm/whatsapp-agent/playbooks";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () => {
  await seedDefaultPlaybooks();
  return NextResponse.json({ items: await listPlaybooks() });
});

export const POST = withStaff("owner", async ({ req, staff }) => {
  const parsed = playbookSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const row = await upsertPlaybook({ ...parsed.data, source: "manual" });
  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "WhatsAppPlaybook",
    entityId: row.id,
    changes: { name: row.name },
  });
  return NextResponse.json({ item: row });
});
