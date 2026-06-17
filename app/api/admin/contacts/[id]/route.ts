import { NextRequest, NextResponse } from "next/server";
import type { ContactSource } from "@prisma/client";
import type { CountryCode } from "libphonenumber-js";
import { resolveAdminStaff, requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  contactPhoneConfirmationMatches,
  deleteContactAndRelations,
} from "@/lib/crm/delete-contact";
import { getContactById } from "@/lib/crm/contacts";
import { isPlaceholderContactPhone } from "@/lib/crm/checkout-placeholder";
import { prisma } from "@/lib/db";
import { deleteContactSchema } from "@/lib/validations/admin";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: Ctx) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await ctx.params;
  const contact = await getContactById(id);
  if (!contact) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ contact });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const now = new Date();
  const displayName =
    body.displayName?.trim() ||
    (body.lastName
      ? `${body.firstName?.trim() ?? ""} ${body.lastName.trim()}`.trim()
      : body.firstName?.trim()) ||
    undefined;

  const contact = await prisma.contact.update({
    where: { id },
    data: {
      firstName: body.firstName,
      lastName: body.lastName ?? null,
      displayName: displayName ?? null,
      email: body.email?.trim() || null,
      countryIso: body.countryIso?.toUpperCase() || null,
      timezone: body.timezone,
      preferredLocale: body.preferredLocale,
      source: body.source as ContactSource | undefined,
      sourceDetail: body.sourceDetail?.trim() || null,
      tiktokHandle: body.tiktokHandle?.trim() || null,
      notes: body.notes ?? null,
      ...(body.consentData === true ? { consentDataAt: now } : {}),
      ...(body.consentMarketing === true ? { consentMarketingAt: now } : {}),
      ...(body.consentData === false ? { consentDataAt: null } : {}),
      ...(body.consentMarketing === false ? { consentMarketingAt: null } : {}),
    },
  });

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "Contact",
    entityId: id,
    changes: body,
  });

  return NextResponse.json({ contact });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = deleteContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const existing = await prisma.contact.findUnique({
    where: { id },
    select: {
      id: true,
      phoneE164: true,
      phoneCountryIso: true,
      countryIso: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (isPlaceholderContactPhone(existing.phoneE164)) {
    return NextResponse.json({ error: "placeholder" }, { status: 400 });
  }

  const defaultCountry = (existing.phoneCountryIso ??
    existing.countryIso ??
    "CO") as CountryCode;

  if (
    !contactPhoneConfirmationMatches(
      existing.phoneE164,
      parsed.data.phoneConfirm,
      defaultCountry
    )
  ) {
    return NextResponse.json({ error: "phone_mismatch" }, { status: 400 });
  }

  try {
    const deleted = await deleteContactAndRelations(id);
    if (!deleted) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    fireAuditLog({
      staffUserId: staff.id,
      action: "DELETE",
      entityType: "Contact",
      entityId: id,
      changes: {
        phoneE164: existing.phoneE164,
        firstName: existing.firstName,
        lastName: existing.lastName,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "PLACEHOLDER") {
      return NextResponse.json({ error: "placeholder" }, { status: 400 });
    }
    throw err;
  }
}
