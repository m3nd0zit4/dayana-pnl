import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { buildTemplatedWhatsAppUrl } from "@/lib/crm/messages";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => null);
  if (!body?.contactId || !body?.templateKey) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
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
}
