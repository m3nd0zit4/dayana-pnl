import { NextRequest, NextResponse } from "next/server";
import { WorkshopEditionStatus } from "@prisma/client";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { uniqueSlug } from "@/lib/crm/slug";
import { upsertWorkshopEdition } from "@/lib/crm/workshop-editions";
import { prisma } from "@/lib/db";
import { crmEditionWhere } from "@/lib/workshops-db";
import { isVirtualWorkshopSlug } from "@/lib/workshops";
import { workshopEditionSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

const toInput = (body: ReturnType<typeof workshopEditionSchema.parse>) => ({
  title: body.title,
  editionLabel: body.editionLabel,
  cardSummary: body.cardSummary,
  status: body.status as WorkshopEditionStatus | undefined,
  dateLabel: body.dateLabel,
  scheduleLabel: body.scheduleLabel,
  capacity: body.capacity,
  whatsappTemplate: body.whatsappTemplate,
  startsAt: body.startsAt ? new Date(body.startsAt) : null,
  productId: body.productId,
  heroLine1: body.heroLine1,
  heroLine2: body.heroLine2,
  heroLine3: body.heroLine3,
  detailSummary: body.detailSummary,
  intro: body.intro,
  focusTopics: body.focusTopics,
  daySchedule: body.daySchedule,
  topicsSectionTitle: body.topicsSectionTitle,
  topicsSectionDescription: body.topicsSectionDescription,
  scheduleSectionDescription: body.scheduleSectionDescription,
  metaTitle: body.metaTitle,
  metaDescription: body.metaDescription,
  introOpen: body.introOpen,
});

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const editions = await prisma.workshopEdition.findMany({
    where: crmEditionWhere,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ editions });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => null);
  const parsed = workshopEditionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let slug = String(parsed.data.slug ?? "").trim();
  if (!slug) {
    slug = await uniqueSlug(parsed.data.title, async (s) => {
      const found = await prisma.workshopEdition.findUnique({ where: { slug: s } });
      return !!found;
    });
  }

  if (isVirtualWorkshopSlug(slug)) {
    return NextResponse.json({ error: "virtual_edition" }, { status: 400 });
  }

  const edition = await upsertWorkshopEdition(slug, toInput(parsed.data));

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPSERT",
    entityType: "WorkshopEdition",
    entityId: edition.id,
  });

  return NextResponse.json({ edition });
}
