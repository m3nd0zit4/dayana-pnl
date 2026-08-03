import type { WorkshopEditionStatus } from "@prisma/client";
import {
  BRAND,
  SOCIAL_LINKS,
  WHATSAPP_NUMBER,
  buildWhatsAppUrl,
} from "../contact";
import { getSiteUrl } from "../site-url";
import { SITE_DESCRIPTION } from "./site-meta";
import type { Plan } from "../plans";

const orgId = () => `${getSiteUrl()}/#organization`;

/**
 * Sitewide Organization/ProfessionalService node. Only real, verifiable
 * facts — no address, ratings, or credentials exist for this business, so
 * those fields are intentionally omitted rather than fabricated.
 */
export const buildOrganizationSchema = () => {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": orgId(),
    name: BRAND.name,
    alternateName: BRAND.shortName,
    description: SITE_DESCRIPTION,
    url: siteUrl,
    image: `${siteUrl}/og-image.png`,
    foundingDate: String(BRAND.startedYear),
    email: SOCIAL_LINKS.email.replace(/^mailto:/, ""),
    sameAs: [
      SOCIAL_LINKS.instagram,
      SOCIAL_LINKS.tiktok,
      SOCIAL_LINKS.youtube,
      SOCIAL_LINKS.facebook,
    ],
    contactPoint: {
      "@type": "ContactPoint",
      telephone: WHATSAPP_NUMBER,
      contactType: "customer service",
      availableLanguage: "Spanish",
      url: buildWhatsAppUrl("Hola Dayana, vengo desde la web."),
    },
  };
};

/** One Service node with an Offer per plan per available currency. */
export const buildServiceSchema = (therapyPlans: Plan[]) => {
  const siteUrl = getSiteUrl();
  const offers = therapyPlans.flatMap((plan) => {
    const planOffers = [
      {
        "@type": "Offer",
        name: plan.title,
        price: plan.amountUsd,
        priceCurrency: "USD",
        url: `${siteUrl}/servicios`,
        availability: "https://schema.org/InStock",
      },
    ];
    if (plan.amountCop != null) {
      planOffers.push({
        "@type": "Offer",
        name: plan.title,
        price: plan.amountCop,
        priceCurrency: "COP",
        url: `${siteUrl}/servicios`,
        availability: "https://schema.org/InStock",
      });
    }
    return planOffers;
  });

  return {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Terapia de reprogramación neurolingüística (PNL)",
    provider: { "@id": orgId() },
    offers,
  };
};

export const buildFaqPageSchema = (faqs: { q: string; a: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.a,
    },
  })),
});

export const buildBreadcrumbSchema = (
  items: { name: string; url: string }[]
) => {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${siteUrl}${item.url}`,
    })),
  };
};

const eventStatusFor = (status: WorkshopEditionStatus) =>
  status === "COMPLETED"
    ? "https://schema.org/EventCompleted"
    : "https://schema.org/EventScheduled";

export type WorkshopEventInput = {
  slug: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  status: WorkshopEditionStatus;
};

/** Only call when `startsAt` is a real DB value — never fabricate a date. */
export const buildWorkshopEventSchema = (input: WorkshopEventInput) => {
  const siteUrl = getSiteUrl();
  const url = `${siteUrl}/taller-virtual/${input.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: input.title,
    description: input.description,
    startDate: input.startsAt.toISOString(),
    ...(input.endsAt ? { endDate: input.endsAt.toISOString() } : {}),
    eventStatus: eventStatusFor(input.status),
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: {
      "@type": "VirtualLocation",
      url,
    },
    organizer: { "@id": orgId() },
    url,
  };
};
