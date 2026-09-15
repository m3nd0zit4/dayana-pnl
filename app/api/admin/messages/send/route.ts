import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { buildTemplatedWhatsAppUrl } from "@/lib/crm/messages";

export const dynamic = "force-dynamic";

export const POST = withStaff("write", async ({ req, staff }) => {
  const body = await readJson(req);
  if (!body?.contactId || !body?.templateKey) {
    return apiError("missing_fields", 400);
  }

  const vars =
    typeof body.vars === "object" && body.vars !== null
      ? (body.vars as Record<string, string>)
      : {};

  const url = await buildTemplatedWhatsAppUrl(
    body.contactId,
    body.templateKey,
    vars,
    staff.id
  );

  return NextResponse.json({ url });
});
