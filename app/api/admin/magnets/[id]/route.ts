import { NextRequest, NextResponse } from "next/server";

import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { deleteMagnet, normalizeKeyword, updateMagnet } from "@/lib/crm/magnets";
import { magnetSchema } from "../route";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const parsed = magnetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path.at(-1) ?? "");
    return NextResponse.json(
      { error: field === "deliveryUrl" ? "invalid_url" : "invalid_body" },
      { status: 400 }
    );
  }
  if (!normalizeKeyword(parsed.data.keyword)) {
    return NextResponse.json({ error: "invalid_keyword" }, { status: 400 });
  }

  try {
    const magnet = await updateMagnet(id, parsed.data);
    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "KeywordMagnet",
      entityId: magnet.id,
      changes: { keyword: magnet.keyword, isActive: magnet.isActive },
    });
    return NextResponse.json({ magnet });
  } catch (e) {
    if (e instanceof Error && e.message === "KEYWORD_TAKEN") {
      return NextResponse.json({ error: "keyword_taken" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  await deleteMagnet(id);
  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "KeywordMagnet",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}
