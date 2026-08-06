import { NextRequest, NextResponse } from "next/server";
import { WorkshopEditionStatus } from "@prisma/client";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { uniqueSlug } from "@/lib/crm/slug";
import { upsertWorkshopEdition } from "@/lib/crm/workshop-editions";
import {
  getOperationalTimezone,
  zonedDateTimeToUtc,
} from "@/lib/crm/operational-timezone";
import { prisma } from "@/lib/db";
import { crmEditionWhere } from "@/lib/workshops-db";
import { isVirtualWorkshopSlug } from "@/lib/workshops";
import { workshopEditionSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

const DATE_ONLY_ANCHOR = "12:00";

const toInput = async (
  body: ReturnType<typeof workshopEditionSchema.parse>
) => {
  const tz = await getOperationalTimezone();
  let startsAt: Date | null | undefined = undefined;
  if (body.startsAtLocal !== undefined) {
    if (body.startsAtLocal === null) {
      startsAt = null;
    } else {
      const time = body.startsAtLocal.time?.trim() ?? "";
      const hasTime = /^\d{1,2}:\d{2}$/.test(time);
      startsAt = zonedDateTimeToUtc(
        body.startsAtLocal.date,
        hasTime ? time : DATE_ONLY_ANCHOR,
        tz
      );
    }
  } else if (body.startsAt !== undefined) {
    startsAt = body.startsAt ? new Date(body.startsAt) : null;
  }

  return {
    title: body.title,
    editionLabel: body.editionLabel,
    cardSummary: body.cardSummary,
    status: body.status as WorkshopEditionStatus | undefined,
    dateLabel: body.dateLabel,
    scheduleLabel: body.scheduleLabel,
    capacity: body.capacity,
    whatsappTemplate: body.whatsappTemplate,
    startsAt,
    timezone: tz,
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
  };
};

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const editions = await prisma.workshopEdition.findMany({
    where: crmEditionWhere,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    editions,
    operationalTimezone: await getOperationalTimezone(),
  });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const raw = await req.json().catch(() => null);
  const parsed = workshopEditionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let slug = String(parsed.data.slug ?? "").trim();
  if (!slug) {
    slug = await uniqueSlug(parsed.data.title, async (s) => {
      const found = await prisma.workshopEdition.findUnique({
        where: { slug: s },
      });
      return !!found;
    });
  }

  if (isVirtualWorkshopSlug(slug)) {
    return NextResponse.json({ error: "virtual_edition" }, { status: 400 });
  }

  try {
    const edition = await upsertWorkshopEdition(
      slug,
      await toInput(parsed.data)
    );
    fireAuditLog({
      staffUserId: staff.id,
      action: "UPSERT",
      entityType: "WorkshopEdition",
      entityId: edition.id,
    });
    return NextResponse.json({ edition });
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_ZONED_DATETIME") {
      return NextResponse.json(
        { error: "invalid_datetime", message: "Fecha u hora inválida." },
        { status: 400 }
      );
    }
    throw e;
  }
}
