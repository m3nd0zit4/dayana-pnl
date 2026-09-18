import { NextResponse } from "next/server";
import { WorkshopEditionStatus } from "@prisma/client";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { majorToMinor } from "@/lib/crm/money";
import { uniqueSlug } from "@/lib/crm/slug";
import {
  getWorkshopEditionWithPricing,
  listWorkshopEditionsAdminWithPricing,
  parseWorkshopPriceFields,
  upsertWorkshopEdition,
} from "@/lib/crm/workshop-editions";
import { syncWorkshopEditionPrice } from "@/lib/crm/workshop-pricing";
import {
  getOperationalTimezone,
  zonedDateTimeToUtc,
} from "@/lib/crm/operational-timezone";
import { prisma } from "@/lib/db";
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
    // Nunca del cliente en una edición nueva: el producto lo crea y enlaza
    // `syncWorkshopEditionPrice` justo después de este alta, a partir del
    // precio que se haya mandado. Ver TASKS §2.
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

export const GET = withStaff("read", async () => {
  const editions = await listWorkshopEditionsAdminWithPricing();
  return NextResponse.json({
    editions,
    operationalTimezone: await getOperationalTimezone(),
  });
});

export const POST = withStaff("write", async ({ req, staff }) => {
  const raw = await readJson(req);
  const parsed = workshopEditionSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }
  const { priceCop, priceUsd } = parseWorkshopPriceFields(raw);

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
    return apiError("virtual_edition", 400);
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

    try {
      await syncWorkshopEditionPrice({
        slug: edition.slug,
        title: edition.title,
        status: edition.status,
        copPesos: priceCop,
        usdCents: priceUsd !== undefined ? majorToMinor(priceUsd, "USD") : undefined,
      });
    } catch (syncError) {
      console.error("[workshops] no se pudo sincronizar el precio", syncError);
      return apiError("price_sync_failed", 500);
    }

    const shaped = await getWorkshopEditionWithPricing(edition.slug);
    return NextResponse.json({
      edition: shaped ?? edition,
      prices: shaped?.prices ?? { cop: null, usd: null },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_ZONED_DATETIME") {
      return apiError("invalid_datetime", 400, { message: "Fecha u hora inválida." });
    }
    throw e;
  }
});
