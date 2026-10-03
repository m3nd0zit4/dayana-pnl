import { NextResponse } from "next/server";
import { WorkshopEditionStatus } from "@prisma/client";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import {
  getWorkshopEditionWithPricing,
  parseWorkshopPriceFields,
  renameWorkshopSlug,
  updateWorkshopEditionBySlug,
  type WorkshopEditionInput,
} from "@/lib/crm/workshop-editions";
import { isWorkshopDatePast, isWorkshopEnded } from "@/lib/crm/workshop-lifecycle-rules";
import { canOpenWithPrice, syncWorkshopEditionPrice } from "@/lib/crm/workshop-pricing";
import { validateWorkshopPrices } from "@/lib/crm/workshop-price-rows";
import { isValidWorkshopSlug } from "@/lib/crm/workshop-slug";
import { isVirtualWorkshopSlug } from "@/lib/workshops";
import { workshopEditionSchema } from "@/lib/validations/admin";
import { deleteWorkshopResponse, findEdition, scheduleFromLocal, workshopErrorResponse } from "../_lib/lifecycle";

type Params = { slug: string };

export const dynamic = "force-dynamic";

/** El guardado puede ser solo la página, solo el precio o los dos. */
const patchSchema = workshopEditionSchema.partial();

/** Claves que no son de la página (precio, URL, estado). */
const NON_PAGE_KEYS = new Set(["priceCop", "priceUsd", "newSlug", "status", "slug"]);

export const GET = withStaff<Params>("read", async ({ params }) => {
  const edition = await getWorkshopEditionWithPricing(params.slug);
  if (!edition || isVirtualWorkshopSlug(params.slug)) return apiError("not_found", 404);
  return NextResponse.json({ edition, operationalTimezone: await getOperationalTimezone() });
});

/**
 * Guarda la página («Página») y/o el precio («Precio») de una edición. El
 * estado ya no se escribe aquí: publicar, cerrar inscripciones, terminar y
 * reabrir tienen su ruta, que deja historia y alinea el producto.
 */
export const PATCH = withStaff<Params>("write", async ({ req, staff, params }) => {
  let { slug } = params;
  if (isVirtualWorkshopSlug(slug)) return apiError("virtual_edition", 400);

  const body = await readJson(req);
  const parsed = patchSchema.safeParse(body ?? {});
  if (!parsed.success) return apiError("invalid_body", 400);
  const prices = validateWorkshopPrices(parseWorkshopPriceFields(body));
  if (!prices.ok) return apiError("invalid_price", 400);

  const existing = await findEdition(slug);
  if (!existing) return apiError("not_found", 404);

  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    return apiError("status_via_lifecycle", 400, {
      message: "El estado se cambia con los botones del taller: Publicar, Cerrar inscripciones, Terminar o Reabrir.",
    });
  }

  const priceWritten = prices.copPesos !== undefined || prices.usdCents !== undefined;
  // Publicada: escribir un precio no puede dejarla sin precio en pesos.
  if (
    priceWritten &&
    existing.status === WorkshopEditionStatus.OPEN &&
    !(await canOpenWithPrice(slug, prices.copPesos, true))
  ) {
    return apiError("open_requires_cop_price", 400, {
      message: "Publicado, este taller necesita su precio en pesos (COP).",
    });
  }

  // La fecha del panel dice también si lleva hora; un instante suelto (API
  // vieja) se toma como fecha con hora.
  let schedule: { startsAt: Date | null; startsAtHasTime: boolean } | undefined;
  try {
    schedule =
      parsed.data.startsAtLocal !== undefined
        ? await scheduleFromLocal(parsed.data.startsAtLocal)
        : parsed.data.startsAt !== undefined
          ? { startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null, startsAtHasTime: true }
          : undefined;
  } catch (e) {
    return workshopErrorResponse(e) ?? apiError("invalid_datetime", 400);
  }
  const startsAt = schedule?.startsAt;

  // Publicado, no se le pone una fecha que ya pasó: quedaría a la venta algo
  // hecho. Para eso, cerrar inscripciones o terminarlo.
  if (
    schedule?.startsAt &&
    existing.status === WorkshopEditionStatus.OPEN &&
    isWorkshopDatePast({
      ...existing,
      startsAt: schedule.startsAt,
      startsAtHasTime: schedule.startsAtHasTime,
      timezone: await getOperationalTimezone(),
    })
  ) {
    return apiError("past_date", 400, {
      message: "Está publicado: no se le pone una fecha que ya pasó. Cierra las inscripciones o termínalo antes.",
    });
  }

  // Uno que ya pasó no se reprograma ni cambia de sala: para otra fecha, se duplica.
  if (isWorkshopEnded(existing)) {
    const dateChanged =
      schedule !== undefined &&
      ((schedule.startsAt?.getTime() ?? null) !== (existing.startsAt?.getTime() ?? null) ||
        (schedule.startsAt !== null && schedule.startsAtHasTime !== existing.startsAtHasTime));
    const linkChanged =
      parsed.data.meetingUrl !== undefined && (parsed.data.meetingUrl || null) !== (existing.meetingUrl ?? null);
    if (dateChanged || linkChanged) {
      return apiError("ended", 400, {
        message: "Este taller ya pasó: no se le cambia la fecha ni el enlace. Duplícalo para una fecha nueva.",
      });
    }
  }

  // Cambio de URL: al final de las validaciones, para que un error no la deje
  // cambiada a medias; luego el resto se guarda ya bajo la URL nueva.
  const newSlug = parsed.data.newSlug?.trim();
  if (newSlug && newSlug !== slug) {
    if (!isValidWorkshopSlug(newSlug)) return apiError("invalid_slug", 400);
    if (isVirtualWorkshopSlug(newSlug)) return apiError("virtual_edition", 400);
    try {
      await renameWorkshopSlug(slug, newSlug);
    } catch (e) {
      if (e instanceof Error && e.message === "SLUG_TAKEN") return apiError("slug_taken", 409);
      throw e;
    }
    slug = newSlug;
  }

  const pageKeys = Object.keys(parsed.data).filter((k) => !NON_PAGE_KEYS.has(k));
  let edition = existing;
  if (pageKeys.length > 0) {
    const d = parsed.data;
    const input: WorkshopEditionInput = {
      title: d.title ?? existing.title,
      editionLabel: d.editionLabel,
      cardSummary: d.cardSummary,
      dateLabel: d.dateLabel,
      scheduleLabel: d.scheduleLabel,
      capacity: d.capacity,
      whatsappTemplate: d.whatsappTemplate,
      startsAt,
      ...(schedule ? { startsAtHasTime: schedule.startsAtHasTime, timezone: await getOperationalTimezone() } : {}),
      heroLine1: d.heroLine1,
      heroLine2: d.heroLine2,
      heroLine3: d.heroLine3,
      detailSummary: d.detailSummary,
      intro: d.intro,
      focusTopics: d.focusTopics,
      daySchedule: d.daySchedule,
      topicsSectionTitle: d.topicsSectionTitle,
      topicsSectionDescription: d.topicsSectionDescription,
      scheduleSectionDescription: d.scheduleSectionDescription,
      metaTitle: d.metaTitle,
      metaDescription: d.metaDescription,
      introOpen: d.introOpen,
      meetingUrl: d.meetingUrl,
    };
    edition = await updateWorkshopEditionBySlug(slug, input, { staffUserId: staff.id });
  } else if (slug !== existing.slug) {
    edition = (await findEdition(slug)) ?? existing;
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "WorkshopEdition",
    entityId: edition.id,
    changes: body,
  });

  // Siempre, también sin precio nuevo: el producto propio sigue el título de
  // la edición (checkout, recibos, correos) y su estado. No crea uno sin
  // precio ni toca un paquete compartido heredado.
  {
    try {
      await syncWorkshopEditionPrice({
        slug: edition.slug,
        title: edition.title,
        status: edition.status,
        copPesos: prices.copPesos,
        usdCents: prices.usdCents,
        staffUserId: staff.id,
      });
    } catch (syncError) {
      console.error("[workshops] no se pudo sincronizar el precio", syncError);
      return apiError("price_sync_failed", 500);
    }
  }

  const shaped = await getWorkshopEditionWithPricing(edition.slug);
  return NextResponse.json({
    edition: shaped ?? edition,
    prices: shaped?.prices ?? { cop: null, usd: null },
  });
});

/**
 * Borrar: solo sin pagos y sin publicar. Con compradores se cierra o se
 * termina: borrar dejaría matrículas pagadas sin el taller que pagaron.
 */
export const DELETE = withStaff<Params>("write", async ({ staff, params }) => {
  if (isVirtualWorkshopSlug(params.slug)) return apiError("virtual_edition", 400);
  return deleteWorkshopResponse(params.slug, staff);
});
