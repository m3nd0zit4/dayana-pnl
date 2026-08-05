import {
  PrismaClient,
  ProductKind,
  WorkshopEditionStatus,
} from "@prisma/client";
import { hashStaffPassword } from "../lib/auth/password";
import { COP_PRICES, SEED_PLANS } from "./seed-data";
import {
  PROXIMO_WORKSHOP_SLUG,
  WORKSHOP_DETAIL_SEED,
  WORKSHOPS,
} from "../lib/workshops";

const prisma = new PrismaClient();

const planKindToProduct = (kind: "therapy" | "course", id: string): ProductKind => {
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
  for (const plan of SEED_PLANS) {
    const kind = planKindToProduct(plan.kind, plan.id);
    const sessionsCount =
      plan.kind === "therapy" ? plan.sessionsCount ?? null : null;
    const content = {
      unitPriceLabel: plan.unitPrice ?? null,
      tag: plan.tag ?? null,
      highlight: plan.highlight ?? false,
      whatsappMessage: plan.whatsappMessage,
      therapyHeadline: plan.therapyPresentation?.sessionsHeadline ?? null,
    };

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
        ...content,
      },
      update: {
        kind,
        title: plan.title,
        sessionsLabel: plan.sessions,
        sessionsCount,
        description: plan.features.join("\n"),
        sortOrder: order - 1,
        ...content,
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
    {
      key: "member_invite",
      title: "Invitación portal de miembros",
      body: "Hola {{first_name}}, ya puedes crear tu cuenta del portal de miembros. Crea tu contraseña aquí: {{set_password_url}}",
    },
    {
      key: "member_password_reset",
      title: "Restablecer contraseña portal",
      body: "Hola {{first_name}}, recibimos tu solicitud para restablecer la contraseña. Crea una nueva aquí: {{reset_url}}",
    },
    {
      key: "membership_payment_due",
      title: "Mensualidad por vencer",
      body: "Hola {{first_name}}, tu mensualidad del curso vence el {{paid_until_date}}. Renueva aquí para no perder acceso: {{portal_url}}",
    },
    {
      key: "membership_overdue",
      title: "Mensualidad vencida",
      body: "Hola {{first_name}}, tu mensualidad del curso venció el {{paid_until_date}}. Renueva aquí para recuperar acceso: {{portal_url}}",
    },
    {
      key: "new_recording_posted",
      title: "Nueva grabación disponible",
      body: "Hola {{first_name}}, ya está disponible la grabación de {{class_title}}. Estará un mes en el portal: {{portal_url}}",
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
    { slug: "webinar-gratuito", label: "Webinar gratuito" },
  ];

  for (const t of tags) {
    await prisma.tag.upsert({
      where: { slug: t.slug },
      create: t,
      update: { label: t.label },
    });
  }
}

async function seedFreeWebinar() {
  const learnItems = [
    "Qué es la PNL aplicada a tu día a día (sin jerga innecesaria).",
    "Cómo identificar un patrón mental que te está costando paz o resultados.",
    "Un ejercicio práctico que puedes usar desde el mismo día.",
    "Qué cambia en una sesión 1:1 frente a un taller o al curso en vivo.",
    "Cómo saber si este camino es para ti — sin presión de compra.",
  ];
  const faq = [
    {
      q: "¿El webinar tiene costo?",
      a: "No. El acceso es completamente gratuito; solo necesitas registrarte con tus datos de contacto.",
    },
    {
      q: "¿Necesito experiencia previa en PNL?",
      a: "No. Está pensado para quienes están empezando o quieren claridad antes de dar el siguiente paso.",
    },
    {
      q: "¿Cómo me conecto?",
      a: "Tras registrarte te escribimos con el enlace y los detalles de la sesión en vivo.",
    },
    {
      q: "¿Habrá repetición?",
      a: "Priorizamos la experiencia en vivo. Si hay replay, te lo avisamos por el mismo correo o WhatsApp.",
    },
    {
      q: "¿Me van a vender algo durante el webinar?",
      a: "Habrá espacio para conocer los acompañamientos de Dayana, pero el webinar en sí es gratuito y sin compromiso.",
    },
  ];

  await prisma.freeWebinar.upsert({
    where: { slug: "gratuito" },
    create: {
      slug: "gratuito",
      isActive: false,
      headline: "Reprograma tu mente con PNL — webinar gratuito en vivo",
      subheadline:
        "Una sesión abierta con Dayana Beltrán para entender cómo la PNL y la neuroplasticidad pueden ayudarte a soltar patrones que te frenan.",
      body: "Si sientes que repites las mismas historias, emociones o bloqueos — este webinar es un primer paso claro, sin compromiso y 100% gratis.",
      startsAt: null,
      startsAtHasTime: false,
      learnItems,
      faq,
      ctaLabel: "Registrarme gratis",
      formTitle: "Reserva tu lugar",
      metaTitle: "Webinar gratuito de PNL | Dayana Beltrán",
      metaDescription:
        "Regístrate al webinar gratuito en vivo con Dayana Beltrán. PNL, neurociencia y un primer paso claro para reprogramar patrones que te frenan.",
    },
    update: {},
  });
  console.log("Free webinar landing seeded: gratuito (inactive until schedule is set)");
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

async function seedCopPrices() {
  for (const [productId, { amount, listAmount }] of Object.entries(COP_PRICES)) {
    const existing = await prisma.productPrice.findFirst({
      where: { productId, currency: "COP" },
      orderBy: { validFrom: "desc" },
    });
    if (
      !existing ||
      existing.amountMinor !== amount ||
      existing.listAmountMinor !== (listAmount ?? null)
    ) {
      await prisma.productPrice.create({
        data: {
          productId,
          currency: "COP",
          amountMinor: amount,
          listAmountMinor: listAmount ?? null,
        },
      });
      console.log(`COP price set for ${productId}: ${amount.toLocaleString("es-CO")}`);
    }
  }
}

async function main() {
  await seedProducts();
  await seedCopPrices();
  await seedWorkshops();
  await seedMessageTemplates();
  await seedTags();
  await seedFreeWebinar();
  await seedStaffOwner();
  console.log("Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
