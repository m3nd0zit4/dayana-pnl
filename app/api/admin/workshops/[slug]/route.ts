import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { majorToMinor } from "@/lib/crm/money";
import {
  getWorkshopEditionWithPricing,
  parseWorkshopPriceFields,
  updateWorkshopEditionBySlug,
} from "@/lib/crm/workshop-editions";
import { syncWorkshopEditionPrice } from "@/lib/crm/workshop-pricing";
import {
  getOperationalTimezone,
  zonedDateTimeToUtc,
} from "@/lib/crm/operational-timezone";
import { prisma } from "@/lib/db";
import { isVirtualWorkshopSlug } from "@/lib/workshops";
import { workshopEditionSchema } from "@/lib/validations/admin";
import { WorkshopEditionStatus } from "@prisma/client";

type Params = { slug: string };

export const dynamic = "force-dynamic";

const DATE_ONLY_ANCHOR = "12:00";

export const PATCH = withStaff<Params>("write", async ({ req, staff, params }) => {
  const { slug } = params;

  if (isVirtualWorkshopSlug(slug)) {
    return apiError("virtual_edition", 400);
  }

  const body = await readJson(req);
  const parsed = workshopEditionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }
  const { priceCop, priceUsd } = parseWorkshopPriceFields(body);

  const existing = await prisma.workshopEdition.findUnique({ where: { slug } });
  if (!existing) {
    return apiError("not_found", 404);
  }

  const tz = await getOperationalTimezone();
  let startsAt: Date | null | undefined = undefined;
  if (parsed.data.startsAtLocal !== undefined) {
    if (parsed.data.startsAtLocal === null) {
      startsAt = null;
    } else {
      const time = parsed.data.startsAtLocal.time?.trim() ?? "";
      const hasTime = /^\d{1,2}:\d{2}$/.test(time);
      try {
        startsAt = zonedDateTimeToUtc(
          parsed.data.startsAtLocal.date,
          hasTime ? time : DATE_ONLY_ANCHOR,
          tz
        );
      } catch {
        return apiError("invalid_datetime", 400, { message: "Fecha u hora inválida." });
      }
    }
  } else if (parsed.data.startsAt !== undefined) {
    startsAt = parsed.data.startsAt ? new Date(parsed.data.startsAt) : null;
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
    startsAt,
    timezone: tz,
    productId: parsed.data.productId,
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
});

export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  const { slug } = params;

  if (isVirtualWorkshopSlug(slug)) {
    return apiError("virtual_edition", 400);
  }

  const edition = await prisma.workshopEdition.delete({ where: { slug } });

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "WorkshopEdition",
    entityId: edition.id,
  });

  return NextResponse.json({ ok: true });
});
