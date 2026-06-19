import {
  PrismaClient,
  ProductKind,
  WorkshopEditionStatus,
} from "@prisma/client";
import { hashStaffPassword } from "../lib/auth/password";
import { PLANS, type PlanId } from "../lib/plans";
import {
  PROXIMO_WORKSHOP_SLUG,
  WORKSHOP_DETAIL_SEED,
  WORKSHOPS,
} from "../lib/workshops";

const prisma = new PrismaClient();

const SESSIONS_BY_PLAN: Partial<Record<PlanId, number>> = {
  "therapy-1": 1,
  "therapy-3": 3,
  "therapy-6": 6,
  "therapy-12": 12,
  "therapy-24": 24,
};

const planKindToProduct = (kind: "therapy" | "course", id: PlanId): ProductKind => {
  if (kind === "therapy") return ProductKind.THERAPY;
  if (id === "workshop-virtual") return ProductKind.WORKSHOP;
  return ProductKind.COURSE;
};

const workshopStatusMap = (
  status: "completed" | "upcoming" | "open"
): WorkshopEditionStatus => {
  switch (status) {
    case "open":
      return WorkshopEditionStatus.OPEN;
    case "completed":
      return WorkshopEditionStatus.COMPLETED;
    default:
      return WorkshopEditionStatus.DRAFT;
  }
};

async function seedProducts() {
  let order = 0;
  for (const plan of Object.values(PLANS)) {
    const kind = planKindToProduct(plan.kind, plan.id);
    const sessionsCount =
      plan.kind === "therapy" ? SESSIONS_BY_PLAN[plan.id as PlanId] ?? null : null;

    await prisma.product.upsert({
      where: { id: plan.id },
      create: {
        id: plan.id,
        kind,
        title: plan.title,
        sessionsLabel: plan.sessions,
        sessionsCount,
        description: plan.features.join("\n"),
        isActive: true,
        sortOrder: order++,
      },
      update: {
        kind,
        title: plan.title,
        sessionsLabel: plan.sessions,
        sessionsCount,
        description: plan.features.join("\n"),
        sortOrder: order - 1,
      },
    });

    const amountMinor = Math.round(plan.amountUsd * 100);
    const listAmountMinor = plan.listAmountUsd
      ? Math.round(plan.listAmountUsd * 100)
      : null;

    const existingPrice = await prisma.productPrice.findFirst({
      where: { productId: plan.id, currency: "USD" },
      orderBy: { validFrom: "desc" },
    });

    if (
      !existingPrice ||
      existingPrice.amountMinor !== amountMinor ||
      existingPrice.listAmountMinor !== listAmountMinor
    ) {
      await prisma.productPrice.create({
        data: {
          productId: plan.id,
          currency: "USD",
          amountMinor,
          listAmountMinor,
        },
      });
    }
  }
}

async function seedWorkshops() {
  for (const w of WORKSHOPS) {
    if (!w.slug || w.slug === PROXIMO_WORKSHOP_SLUG) continue;

    const landing =
      w.slug === "saca-tu-mejor-version" ? WORKSHOP_DETAIL_SEED : null;

    await prisma.workshopEdition.upsert({
      where: { slug: w.slug },
      create: {
        slug: w.slug,
        productId: w.slug === "saca-tu-mejor-version" ? "workshop-virtual" : null,
        title: w.title || "Próximo taller",
        editionLabel: w.editionLabel || null,
        cardSummary: w.cardSummary || null,
        status: workshopStatusMap(w.status),
        dateLabel: w.dateLabel || null,
        scheduleLabel: w.scheduleLabel || null,
        whatsappTemplate: w.whatsappMessage ?? null,
        startsAt:
          w.slug === "saca-tu-mejor-version"
            ? new Date("2026-05-16T12:30:00.000Z")
            : null,
        heroLine1: landing?.heroLines[0] ?? null,
        heroLine2: landing?.heroLines[1] ?? null,
        heroLine3: landing?.heroLines[2] ?? null,
        detailSummary: landing?.detailSummary ?? null,
        intro: landing?.intro ?? null,
        focusTopics: landing?.focusTopics ?? undefined,
        daySchedule: landing?.daySchedule ?? undefined,
        topicsSectionTitle: landing?.topicsSectionTitle ?? null,
        topicsSectionDescription: landing?.topicsSectionDescription ?? null,
        scheduleSectionDescription: landing?.scheduleSectionDescription ?? null,
        metaTitle: landing?.metaTitle ?? null,
        metaDescription: landing?.metaDescription ?? null,
      },
      update: {
        title: w.title || "Próximo taller",
        editionLabel: w.editionLabel || null,
        cardSummary: w.cardSummary || null,
        status: workshopStatusMap(w.status),
        dateLabel: w.dateLabel || null,
        scheduleLabel: w.scheduleLabel || null,
        whatsappTemplate: w.whatsappMessage ?? null,
        ...(landing
          ? {
              heroLine1: landing.heroLines[0],
              heroLine2: landing.heroLines[1],
              heroLine3: landing.heroLines[2],
              detailSummary: landing.detailSummary,
              intro: landing.intro,
              focusTopics: landing.focusTopics,
              daySchedule: landing.daySchedule,
              topicsSectionTitle: landing.topicsSectionTitle,
              topicsSectionDescription: landing.topicsSectionDescription,
              scheduleSectionDescription: landing.scheduleSectionDescription,
              metaTitle: landing.metaTitle,
              metaDescription: landing.metaDescription,
            }
          : {}),
      },
    });
  }
}

async function seedMessageTemplates() {
  const templates = [
    {
      key: "post_payment_therapy",
      title: "Post-pago terapia",
      body: "Hola {{first_name}}, recibimos tu pago por {{product_title}}. Quedan {{sessions_left}} sesiones por agendar. Escríbeme para coordinar tu primera cita.",
    },
    {
      key: "session_reminder",
      title: "Recordatorio de sesión",
      body: "Hola {{first_name}}, te recuerdo tu sesión el {{session_date}} (hora {{session_time}}). Link Meet: {{meet_url}}",
    },
    {
      key: "workshop_open",
      title: "Taller abierto",
      body: "Hola {{first_name}}, abrimos inscripciones para {{workshop_title}}. Fecha: {{workshop_date}}. ¿Te apunto?",
    },
    {
      key: "lead_followup",
      title: "Seguimiento lead",
      body: "Hola {{first_name}}, ¿sigues interesada en {{product_title}}? Estoy aquí para resolver dudas.",
    },
  ];

  for (const t of templates) {
    await prisma.messageTemplate.upsert({
      where: { key_locale: { key: t.key, locale: "es" } },
      create: { key: t.key, title: t.title, locale: "es", body: t.body },
      update: { title: t.title, body: t.body },
    });
  }
}

async function seedTags() {
  const tags = [
    { slug: "interes-taller", label: "Interés taller" },
    { slug: "terapia-activa", label: "Terapia activa" },
    { slug: "alumni-curso", label: "Alumni curso" },
    { slug: "lead-sin-pago", label: "Lead sin pago" },
  ];

  for (const t of tags) {
    await prisma.tag.upsert({
      where: { slug: t.slug },
      create: t,
      update: { label: t.label },
    });
  }
}

async function seedStaffOwner() {
  const email = process.env.STAFF_OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.STAFF_OWNER_PASSWORD;
  const displayName = process.env.STAFF_OWNER_NAME?.trim() ?? "Dayana Beltrán";

  if (!email || !password) {
    console.warn(
      "Skip staff seed: set STAFF_OWNER_EMAIL and STAFF_OWNER_PASSWORD in .env"
    );
    return;
  }

  const passwordHash = await hashStaffPassword(password);
  await prisma.staffUser.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      displayName,
      role: "OWNER",
    },
    update: {
      displayName,
      role: "OWNER",
      passwordHash,
      isActive: true,
    },
  });
  console.log(`Staff OWNER seeded: ${email}`);
}

async function main() {
  await seedProducts();
  await seedWorkshops();
  await seedMessageTemplates();
  await seedTags();
  await seedStaffOwner();
  console.log("Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
