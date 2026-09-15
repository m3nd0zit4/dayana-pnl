import { NextRequest, NextResponse } from "next/server";
import { ContactSource } from "@prisma/client";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  countContacts,
  searchContacts,
  upsertContactByPhone,
} from "@/lib/crm/contacts";
import { clampTake } from "@/lib/crm/pagination";
import { createContactSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const started = Date.now();
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const sp = req.nextUrl.searchParams;
  const filters = {
    q: sp.get("q") ?? "",
    countryIso: sp.get("country") ?? undefined,
    source: (sp.get("source") as ContactSource) || undefined,
    activeTherapy: sp.get("activeTherapy") === "1",
    searchNotes: sp.get("notes") === "1",
  };

  const { items, nextCursor } = await searchContacts({
    ...filters,
    limit: clampTake(sp.get("limit")),
    cursor: sp.get("cursor") ?? undefined,
  });

  // El total solo hace falta en la primera página: el cliente lo guarda y las
  // siguientes solo añaden filas. Contar en cada «cargar más» sería un scan
  // completo por pulsación.
  const total = sp.get("cursor") ? null : await countContacts(filters);

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[api] GET /api/admin/contacts ${Date.now() - started}ms (${items.length} rows)`
    );
  }

  return NextResponse.json({ contacts: items, nextCursor, total });
}

export const POST = withStaff("write", async ({ req, staff }) => {
  const raw = await readJson(req);
  const parsed = createContactSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError("missing_fields", 400);
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
      return apiError("invalid_phone", 400);
    }
    throw e;
  }
});
