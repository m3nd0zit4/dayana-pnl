import { EnrollmentStatus, type ContactSource, type Prisma } from "@prisma/client";
import { prisma } from "../db";
import { PLACEHOLDER_PHONE_PREFIX } from "./checkout-placeholder";
import { normalizePhone, type NormalizedPhone } from "../phone";

export type UpsertContactInput = {
  phone: string;
  phoneCountry?: string;
  firstName?: string;
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

const DEFAULT_CHECKOUT_FIRST_NAME = "Cliente";

function buildDisplayName(
  firstName: string,
  lastName: string | null,
  phoneE164: string
): string {
  if (lastName) return `${firstName} ${lastName}`;
  if (firstName !== DEFAULT_CHECKOUT_FIRST_NAME) return firstName;
  return phoneE164;
}

export const upsertContactByPhone = async (
  input: UpsertContactInput
): Promise<{
  contact: Prisma.ContactGetPayload<object>;
  phone: NormalizedPhone;
  created: boolean;
}> => {
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
  const firstNameTrim = input.firstName?.trim() ?? "";
  const lastNameTrim = input.lastName?.trim() || null;
  const emailTrim = input.email?.trim() || null;

  const existing = await prisma.contact.findUnique({
    where: { phoneE164: normalized.phoneE164 },
  });

  if (!existing) {
    const firstName = firstNameTrim || DEFAULT_CHECKOUT_FIRST_NAME;
    const contact = await prisma.contact.create({
      data: {
        phoneE164: normalized.phoneE164,
        phoneCountryIso: normalized.phoneCountryIso,
        firstName,
        lastName: lastNameTrim,
        displayName: buildDisplayName(firstName, lastNameTrim, normalized.phoneE164),
        email: emailTrim,
        countryIso: input.countryIso?.toUpperCase() || normalized.phoneCountryIso,
        timezone: input.timezone || "America/Bogota",
        preferredLocale: input.preferredLocale || "es",
        source: input.source ?? "WEB",
        sourceDetail: input.sourceDetail ?? null,
        notes: input.notes ?? null,
        consentDataAt: input.consentData ? now : undefined,
        consentMarketingAt: input.consentMarketing ? now : undefined,
      },
    });
    return { contact, phone: normalized, created: true };
  }

  const update: Prisma.ContactUpdateInput = {
    countryIso: input.countryIso?.toUpperCase() || normalized.phoneCountryIso,
    ...(input.consentData ? { consentDataAt: now } : {}),
    ...(input.consentMarketing ? { consentMarketingAt: now } : {}),
    ...(emailTrim ? { email: emailTrim } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.timezone ? { timezone: input.timezone } : {}),
    ...(input.preferredLocale ? { preferredLocale: input.preferredLocale } : {}),
  };

  if (firstNameTrim) {
    update.firstName = firstNameTrim;
    update.lastName = lastNameTrim;
    update.displayName = buildDisplayName(
      firstNameTrim,
      lastNameTrim,
      normalized.phoneE164
    );
  }

  const contact = await prisma.contact.update({
    where: { id: existing.id },
    data: update,
  });

  return { contact, phone: normalized, created: false };
};

const GENERIC_CONTACT_NAMES = new Set([
  DEFAULT_CHECKOUT_FIRST_NAME,
  "Pendiente",
  "Cliente",
]);

/** Fill missing email or generic name from payment provider payer data. */
export const enrichContactFromPayer = async (
  contactId: string,
  input: { email?: string; firstName?: string; lastName?: string }
): Promise<void> => {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) return;

  const update: Prisma.ContactUpdateInput = {};
  const emailTrim = input.email?.trim().toLowerCase();
  if (emailTrim && !contact.email) {
    update.email = emailTrim;
  }

  const firstNameTrim = input.firstName?.trim();
  const lastNameTrim = input.lastName?.trim();
  const nameIsGeneric = GENERIC_CONTACT_NAMES.has(contact.firstName);

  if (firstNameTrim && nameIsGeneric) {
    update.firstName = firstNameTrim;
    update.lastName = lastNameTrim ?? contact.lastName;
    update.displayName = buildDisplayName(
      firstNameTrim,
      (lastNameTrim ?? contact.lastName) || null,
      contact.phoneE164
    );
  }

  if (Object.keys(update).length === 0) return;

  await prisma.contact.update({
    where: { id: contactId },
    data: update,
  });
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
