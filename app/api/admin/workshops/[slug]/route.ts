import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { updateWorkshopEditionBySlug } from "@/lib/crm/workshop-editions";
import { prisma } from "@/lib/db";
import { isVirtualWorkshopSlug } from "@/lib/workshops";
import { workshopEditionSchema } from "@/lib/validations/admin";
import { WorkshopEditionStatus } from "@prisma/client";

type Ctx = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { slug } = await ctx.params;

  if (isVirtualWorkshopSlug(slug)) {
    return NextResponse.json({ error: "virtual_edition" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = workshopEditionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const existing = await prisma.workshopEdition.findUnique({ where: { slug } });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const edition = await updateWorkshopEditionBySlug(slug, {
    title: parsed.data.title,
    editionLabel: parsed.data.editionLabel,
    cardSummary: parsed.data.cardSummary,
    status: parsed.data.status as WorkshopEditionStatus | undefined,
    dateLabel: parsed.data.dateLabel,
    scheduleLabel: parsed.data.scheduleLabel,
    capacity: parsed.data.capacity,
    whatsappTemplate: parsed.data.whatsappTemplate,
    startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
    heroLine1: parsed.data.heroLine1,
    heroLine2: parsed.data.heroLine2,
    heroLine3: parsed.data.heroLine3,
    detailSummary: parsed.data.detailSummary,
    intro: parsed.data.intro,
    focusTopics: parsed.data.focusTopics,
    daySchedule: parsed.data.daySchedule,
    topicsSectionTitle: parsed.data.topicsSectionTitle,
    topicsSectionDescription: parsed.data.topicsSectionDescription,
    scheduleSectionDescription: parsed.data.scheduleSectionDescription,
    metaTitle: parsed.data.metaTitle,
    metaDescription: parsed.data.metaDescription,
    introOpen: parsed.data.introOpen,
  });

  fireAuditLog({
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

  if (isVirtualWorkshopSlug(slug)) {
    return NextResponse.json({ error: "virtual_edition" }, { status: 400 });
  }

  const edition = await prisma.workshopEdition.delete({ where: { slug } });

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "WorkshopEdition",
    entityId: edition.id,
  });

  return NextResponse.json({ ok: true });
}
