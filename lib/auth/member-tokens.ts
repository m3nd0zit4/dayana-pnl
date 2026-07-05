import crypto from "crypto";
import type { MemberAuthTokenPurpose } from "@prisma/client";
import { prisma } from "@/lib/db";

const TOKEN_TTL_MS: Record<MemberAuthTokenPurpose, number> = {
  INVITE: 7 * 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 2 * 60 * 60 * 1000,
};

const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

/**
 * Issues a single-use token for the contact. Previous unused tokens of the
 * same purpose are invalidated so only the latest emailed link works.
 * Returns the RAW token (only ever exists in the email link).
 */
export const createMemberAuthToken = async (input: {
  contactId: string;
  purpose: MemberAuthTokenPurpose;
  createdByStaffId?: string | null;
}): Promise<string> => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[input.purpose]);

  await prisma.$transaction([
    prisma.memberAuthToken.updateMany({
      where: {
        contactId: input.contactId,
        purpose: input.purpose,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    }),
    prisma.memberAuthToken.create({
      data: {
        contactId: input.contactId,
        tokenHash: hashToken(rawToken),
        purpose: input.purpose,
        expiresAt,
        createdByStaffId: input.createdByStaffId ?? null,
      },
    }),
  ]);

  return rawToken;
};

/**
 * Consumes a raw token: marks it used and returns the contactId, or null if
 * unknown / expired / already used. INVITE and PASSWORD_RESET are
 * interchangeable on consumption — both prove email ownership to set a password.
 */
export const consumeMemberAuthToken = async (
  rawToken: string
): Promise<string | null> => {
  if (!rawToken || rawToken.length > 128) return null;
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const rows = await prisma.memberAuthToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (rows.count === 0) return null;

  const row = await prisma.memberAuthToken.findUnique({
    where: { tokenHash },
    select: { contactId: true },
  });
  return row?.contactId ?? null;
};

/** Peek without consuming — used to render the set-password form. */
export const peekMemberAuthToken = async (
  rawToken: string
): Promise<{ contactId: string; email: string | null } | null> => {
  if (!rawToken || rawToken.length > 128) return null;
  const row = await prisma.memberAuthToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      contactId: true,
      usedAt: true,
      expiresAt: true,
      contact: { select: { email: true } },
    },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  return { contactId: row.contactId, email: row.contact.email };
};
