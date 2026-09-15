import { NextResponse } from "next/server";
import type { ContactSource } from "@prisma/client";
import type { CountryCode } from "libphonenumber-js";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  contactDeleteConfirmationMatches,
  deleteContactAndRelations,
} from "@/lib/crm/delete-contact";
import { getContactById } from "@/lib/crm/contacts";
import { isPlaceholderContactPhone } from "@/lib/crm/checkout-placeholder";
import { hasRealContactPhone } from "@/lib/crm/contact-phone";
import { normalizePhoneWithCountry } from "@/lib/phone";
import { prisma } from "@/lib/db";
import { deleteContactSchema } from "@/lib/validations/admin";

type Params = { id: string };

export const dynamic = "force-dynamic";

export const GET = withStaff<Params>("read", async ({ params }) => {
  const { id } = params;
  const contact = await getContactById(id);
  if (!contact) {
    return apiError("not_found", 404);
  }
  return NextResponse.json({ contact });
});

export const PATCH = withStaff<Params>("write", async ({ req, staff, params }) => {
  const { id } = params;
  const body = await readJson(req);
  if (!body) {
    return apiError("invalid_json", 400);
  }

  const now = new Date();
  const displayName =
    body.displayName?.trim() ||
    (body.lastName
      ? `${body.firstName?.trim() ?? ""} ${body.lastName.trim()}`.trim()
      : body.firstName?.trim()) ||
    undefined;

  // Completar teléfono: solo para contactos SIN número real (cuentas creadas
  // con Google o correo, placeholder "+google:/+signup:"). Un teléfono real
  // ya existente no se cambia por PATCH — es la identidad del contacto y la
  // confirmación de borrado depende de él.
  let phoneUpdate: { phoneE164: string; phoneCountryIso: string } | undefined;
  if (typeof body.phone === "string" && body.phone.trim()) {
    const existing = await prisma.contact.findUnique({
      where: { id },
      select: { phoneE164: true },
    });
    if (!existing) {
      return apiError("not_found", 404);
    }
    if (hasRealContactPhone(existing.phoneE164)) {
      return apiError("phone_locked", 400);
    }
    const normalized = normalizePhoneWithCountry(
      body.phone,
      ((body.phoneCountry as string | undefined)?.toUpperCase() ??
        "CO") as CountryCode
    );
    if (!normalized) {
      return apiError("invalid_phone", 400);
    }
    phoneUpdate = normalized;
  }

  let contact;
  try {
    contact = await prisma.contact.update({
      where: { id },
      data: {
        ...(phoneUpdate ?? {}),
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
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e ? String(e.code) : "";
    if (code === "P2002") {
      // phoneE164 es único — el número ya pertenece a otro contacto.
      return apiError("phone_taken", 409);
    }
    throw e;
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "Contact",
    entityId: id,
    changes: body,
  });

  return NextResponse.json({ contact });
});

export const DELETE = withStaff<Params>("write", async ({ req, staff, params }) => {
  const { id } = params;
  const body = await readJson(req);
  const parsed = deleteContactSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("invalid_body", 400);
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
    return apiError("not_found", 404);
  }

  if (isPlaceholderContactPhone(existing.phoneE164)) {
    return apiError("placeholder", 400);
  }

  const defaultCountry = (existing.phoneCountryIso ??
    existing.countryIso ??
    "CO") as CountryCode;

  if (
    !contactDeleteConfirmationMatches(
      existing,
      parsed.data.confirm,
      defaultCountry
    )
  ) {
    return apiError("confirmation_mismatch", 400);
  }

  try {
    const deleted = await deleteContactAndRelations(id);
    if (!deleted) {
      return apiError("not_found", 404);
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
      return apiError("placeholder", 400);
    }
    throw err;
  }
});
