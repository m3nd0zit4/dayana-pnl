import { NextRequest, NextResponse } from "next/server";
import { WorkshopEditionStatus } from "@prisma/client";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { writeAuditLog } from "@/lib/crm/audit";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { slug } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const edition = await prisma.workshopEdition.update({
    where: { slug },
    data: {
      title: body.title,
      editionLabel: body.editionLabel,
      cardSummary: body.cardSummary,
      status: body.status as WorkshopEditionStatus | undefined,
      dateLabel: body.dateLabel,
      scheduleLabel: body.scheduleLabel,
      capacity: body.capacity,
      whatsappTemplate: body.whatsappTemplate,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
    },
  });

  await writeAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "WorkshopEdition",
    entityId: edition.id,
    changes: body,
  });

  return NextResponse.json({ edition });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { slug } = await ctx.params;
  const edition = await prisma.workshopEdition.delete({ where: { slug } });

  await writeAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "WorkshopEdition",
    entityId: edition.id,
  });

  return NextResponse.json({ ok: true });
}
