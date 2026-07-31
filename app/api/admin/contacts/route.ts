import { NextRequest, NextResponse } from "next/server";
import { ContactSource } from "@prisma/client";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { searchContacts, upsertContactByPhone } from "@/lib/crm/contacts";
import { createContactSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const started = Date.now();
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const sp = req.nextUrl.searchParams;
  const contacts = await searchContacts({
    q: sp.get("q") ?? "",
    countryIso: sp.get("country") ?? undefined,
    source: (sp.get("source") as ContactSource) || undefined,
    activeTherapy: sp.get("activeTherapy") === "1",
    limit: 80,
    cursor: sp.get("cursor") ?? undefined,
  });

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[api] GET /api/admin/contacts ${Date.now() - started}ms (${contacts.length} rows)`
    );
  }

  const nextCursor =
    contacts.length === 80 ? contacts[contacts.length - 1]?.id : null;

  return NextResponse.json({ contacts, nextCursor });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const raw = await req.json().catch(() => null);
  const parsed = createContactSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const body = parsed.data;

  try {
    const { contact } = await upsertContactByPhone({
      phone: body.phone,
      phoneCountry: body.phoneCountry,
      firstName: body.firstName ?? undefined,
      lastName: body.lastName ?? undefined,
      email: body.email ?? undefined,
      countryIso: body.countryIso,
      timezone: body.timezone,
      preferredLocale: body.preferredLocale,
      source: (body.source as ContactSource) ?? ContactSource.WHATSAPP_DIRECT,
      sourceDetail: body.sourceDetail,
      notes: body.notes,
      consentData: body.consentData !== false,
      consentMarketing: body.consentMarketing === true,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "Contact",
      entityId: contact.id,
    });

    return NextResponse.json({ contact });
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_PHONE") {
      return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
    }
    throw e;
  }
}
