import { NextRequest, NextResponse } from "next/server";
import { WorkshopEditionStatus } from "@prisma/client";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { uniqueSlug } from "@/lib/crm/slug";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const editions = await prisma.workshopEdition.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ editions });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => null);
  if (!body?.title) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  let slug = String(body.slug ?? "").trim();
  if (!slug) {
    slug = await uniqueSlug(body.title, async (s) => {
      const found = await prisma.workshopEdition.findUnique({ where: { slug: s } });
      return !!found;
    });
  }

  const edition = await prisma.workshopEdition.upsert({
    where: { slug },
    create: {
      slug,
      title: body.title,
      editionLabel: body.editionLabel,
      cardSummary: body.cardSummary,
      status: (body.status as WorkshopEditionStatus) ?? WorkshopEditionStatus.DRAFT,
      dateLabel: body.dateLabel,
      scheduleLabel: body.scheduleLabel,
      productId: body.productId ?? "workshop-virtual",
      capacity: body.capacity,
      whatsappTemplate: body.whatsappTemplate,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
    },
    update: {
      title: body.title,
      editionLabel: body.editionLabel,
      cardSummary: body.cardSummary,
      status: body.status,
      dateLabel: body.dateLabel,
      scheduleLabel: body.scheduleLabel,
      capacity: body.capacity,
      whatsappTemplate: body.whatsappTemplate,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
    },
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPSERT",
    entityType: "WorkshopEdition",
    entityId: edition.id,
  });

  return NextResponse.json({ edition });
}
