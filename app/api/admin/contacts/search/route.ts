import { NextRequest, NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { searchContactsLight } from "@/lib/crm/contacts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const started = Date.now();
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    50,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20))
  );

  const contacts = await searchContactsLight({ q, limit });

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[api] GET /api/admin/contacts/search ${Date.now() - started}ms (${contacts.length} hits)`
    );
  }

  return NextResponse.json({ contacts });
}
