import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { PROXIMO_WORKSHOP_SLUG } from "@/lib/workshops";

import type { OpenWorkshop } from "./whatsapp-agent/workshop-interest";
import { workshopPayUrl } from "./workshop-interests";
import { isRegistrationOpen, REGISTRATION_TEMPLATE_KEY } from "./workshop-registration-rules";

/**
 * El taller visto desde fuera del CRM: qué edición tiene abiertas las
 * inscripciones (el botón «Taller» de `/enlaces`) y la edición de un enlace
 * viejo del registro.
 *
 * Hubo un registro en la página (28-oct a 13-nov: formulario, «Interesadas» y
 * un WhatsApp automático con la plantilla `taller_registro_pagina`). La dueña
 * lo quitó el 13-nov: «quita la lógica de registro… que llegue la persona
 * directamente a WhatsApp preguntando por ello». El botón y los enlaces viejos
 * abren WhatsApp con la pregunta escrita, y las filas «Se registró en la
 * página» que ya existen siguen viéndose en «Interesadas».
 */

// ── El taller ───────────────────────────────────────────────────────────────

export type RegistrationEdition = OpenWorkshop & {
  status: string;
  endedAt: Date | null;
  payUrl: string | null;
  /** `/pagar/p/<producto>`: el botón «Separar mi cupo» de la página (relativo, sirve en cualquier dominio). */
  payPath: string | null;
  open: boolean;
};

const EDITION_SELECT = {
  id: true,
  title: true,
  slug: true,
  status: true,
  endedAt: true,
  startsAt: true,
  startsAtHasTime: true,
  timezone: true,
  dateLabel: true,
  scheduleLabel: true,
  cardSummary: true,
  product: { select: { id: true, isActive: true, prices: { select: { id: true }, take: 1 } } },
} as const;

const toEdition = (e: Prisma.WorkshopEditionGetPayload<{ select: typeof EDITION_SELECT }>, now: Date): RegistrationEdition => {
  const { product, ...rest } = e;
  const payUrl = workshopPayUrl(product);
  return { ...rest, payUrl, payPath: payUrl && product ? `/pagar/p/${product.id}` : null, open: isRegistrationOpen(e, now) };
};

/** La edición por su dirección (nunca «próximo taller»), diga o no que está abierta. */
export const loadRegistrationEdition = async (slug: string, now = new Date()): Promise<RegistrationEdition | null> => {
  if (!slug || slug === PROXIMO_WORKSHOP_SLUG) return null;
  const e = await prisma.workshopEdition.findUnique({ where: { slug }, select: EDITION_SELECT });
  return e ? toEdition(e, now) : null;
};

/**
 * La edición del botón de Enlaces: la más próxima en la que todavía se puede
 * registrar (`isRegistrationOpen`, más estricta que `openWorkshopForAi`, que
 * sigue un día más para contestar preguntas).
 */
export const openWorkshopForRegistration = async (now = new Date()): Promise<{ title: string; slug: string } | null> => {
  const rows = await prisma.workshopEdition.findMany({
    where: {
      status: "OPEN",
      endedAt: null,
      slug: { not: PROXIMO_WORKSHOP_SLUG },
      OR: [{ startsAt: null }, { startsAt: { gte: new Date(now.getTime() - 48 * 3600_000) } }],
    },
    orderBy: { startsAt: "asc" },
    take: 5,
    select: { title: true, slug: true, status: true, endedAt: true, startsAt: true, startsAtHasTime: true, timezone: true },
  });
  const found = rows.find((r) => isRegistrationOpen(r, now));
  return found ? { title: found.title, slug: found.slug } : null;
};

/** La plantilla del registro tal como la dejó Meta (estado y categoría), o null si nunca se mandó. */
export const registrationTemplateState = async (): Promise<{ status: string | null; category: string | null } | null> => {
  const t = await prisma.messageTemplate.findFirst({
    where: { key: REGISTRATION_TEMPLATE_KEY, metaTemplateName: { not: null } },
    select: { metaApprovalStatus: true, metaCategory: true },
  });
  return t ? { status: t.metaApprovalStatus, category: t.metaCategory } : null;
};
