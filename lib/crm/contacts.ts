import { EnrollmentStatus, type ContactSource, type Prisma } from "@prisma/client";
import { prisma } from "../db";
import { PLACEHOLDER_PHONE_PREFIX } from "./checkout-placeholder";
import { normalizePhone, type NormalizedPhone } from "../phone";

export type UpsertContactInput = {
  phone: string;
  phoneCountry?: string;
  firstName: string;
  lastName?: string;
  email?: string;
  countryIso?: string;
  timezone?: string;
  preferredLocale?: string;
  source?: ContactSource;
  sourceDetail?: string;
  consentData?: boolean;
  consentMarketing?: boolean;
  notes?: string;
};

export const upsertContactByPhone = async (
  input: UpsertContactInput
): Promise<{ contact: Prisma.ContactGetPayload<object>; phone: NormalizedPhone }> => {
  const defaultCountry = (
    input.countryIso?.toUpperCase() ||
    input.phoneCountry?.toUpperCase() ||
    "CO"
  ) as "CO";

  const normalized = normalizePhone(input.phone, defaultCountry);
  if (!normalized) {
    throw new Error("INVALID_PHONE");
  }

  const now = new Date();
  const data: Prisma.ContactCreateInput = {
    phoneE164: normalized.phoneE164,
    phoneCountryIso: normalized.phoneCountryIso,
    firstName: input.firstName.trim(),
    lastName: input.lastName?.trim() || null,
    displayName: input.lastName
      ? `${input.firstName.trim()} ${input.lastName.trim()}`
      : input.firstName.trim(),
    email: input.email?.trim() || null,
    countryIso: input.countryIso?.toUpperCase() || normalized.phoneCountryIso,
    timezone: input.timezone || "America/Bogota",
    preferredLocale: input.preferredLocale || "es",
    source: input.source ?? "WEB",
    sourceDetail: input.sourceDetail ?? null,
    notes: input.notes ?? null,
    consentDataAt: input.consentData ? now : undefined,
    consentMarketingAt: input.consentMarketing ? now : undefined,
  };

  const contact = await prisma.contact.upsert({
    where: { phoneE164: normalized.phoneE164 },
    create: data,
    update: {
      firstName: data.firstName,
      lastName: data.lastName,
      displayName: data.displayName,
      email: data.email ?? undefined,
      countryIso: data.countryIso,
      timezone: data.timezone,
      preferredLocale: data.preferredLocale,
      notes: data.notes ?? undefined,
      ...(input.consentData ? { consentDataAt: now } : {}),
      ...(input.consentMarketing ? { consentMarketingAt: now } : {}),
    },
  });

  return { contact, phone: normalized };
};

export const getContactById = async (id: string) =>
  prisma.contact.findUnique({
    where: { id },
    include: {
      enrollments: {
        orderBy: { createdAt: "desc" },
        include: {
          product: true,
          payments: { orderBy: { createdAt: "desc" } },
          therapyPackage: true,
        },
      },
    },
  });

export type ContactSearchFilters = {
  q?: string;
  countryIso?: string;
  source?: ContactSource;
  activeTherapy?: boolean;
  limit?: number;
  cursor?: string;
};

export type ContactLightRow = {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string;
  email: string | null;
  displayName: string | null;
};

const buildContactWhere = (filters: ContactSearchFilters): Prisma.ContactWhereInput => {
  const q = (filters.q ?? "").trim();
  const and: Prisma.ContactWhereInput[] = [
    { NOT: { phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX } } },
  ];

  if (q) {
    const digits = q.replace(/\D/g, "");
    const tokens = q.split(/\s+/).filter((t) => t.length > 0);
    const tokenClauses = tokens.length > 0 ? tokens : [q];

    for (const token of tokenClauses) {
      const tokenDigits = token.replace(/\D/g, "");
      and.push({
        OR: [
          { firstName: { contains: token, mode: "insensitive" } },
          { lastName: { contains: token, mode: "insensitive" } },
          { displayName: { contains: token, mode: "insensitive" } },
          { email: { contains: token, mode: "insensitive" } },
          { notes: { contains: token, mode: "insensitive" } },
          { sourceDetail: { contains: token, mode: "insensitive" } },
          ...(tokenDigits.length >= 4
            ? [{ phoneE164: { contains: tokenDigits } }]
            : []),
          ...(digits.length >= 4 && token === tokens[0]
            ? [{ phoneE164: { contains: digits } }]
            : []),
        ],
      });
    }
  }

  if (filters.countryIso) {
    and.push({ countryIso: filters.countryIso.toUpperCase() });
  }

  if (filters.source) {
    and.push({ source: filters.source });
  }

  if (filters.activeTherapy) {
    and.push({
      enrollments: {
        some: {
          status: "ACTIVE",
          product: { kind: "THERAPY" },
        },
      },
    });
  }

  return and.length > 0 ? { AND: and } : {};
};

const listInclude = {
  enrollments: {
    where: {
      status: {
        in: [
          EnrollmentStatus.ACTIVE,
          EnrollmentStatus.PENDING_PAYMENT,
          EnrollmentStatus.LEAD,
        ],
      },
    },
    take: 5,
    include: { product: true },
  },
} satisfies Prisma.ContactInclude;

export const searchContactsLight = async (
  filters: Pick<ContactSearchFilters, "q" | "limit"> = {}
): Promise<ContactLightRow[]> => {
  const limit = filters.limit ?? 20;
  const where = buildContactWhere(filters);

  return prisma.contact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phoneE164: true,
      email: true,
      displayName: true,
    },
  });
};

export const listContactsLight = async (limit = 200) =>
  prisma.contact.findMany({
    where: { NOT: { phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX } } },
    orderBy: { firstName: "asc" },
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  });

export const searchContacts = async (filters: ContactSearchFilters = {}) => {
  const limit = filters.limit ?? 80;
  const where = buildContactWhere(filters);

  if (filters.cursor) {
    return prisma.contact.findMany({
      where: { AND: [where, { id: { lt: filters.cursor } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: listInclude,
    });
  }

  return prisma.contact.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    include: listInclude,
  });
};
