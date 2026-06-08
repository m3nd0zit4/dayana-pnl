import { NextRequest, NextResponse } from "next/server";
import { ProductKind } from "@prisma/client";
import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { canManageTeam } from "@/lib/crm/staff";
import { writeAuditLog } from "@/lib/crm/audit";
import { uniqueSlug } from "@/lib/crm/slug";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const templates = await prisma.messageTemplate.findMany({
    orderBy: [{ key: "asc" }, { locale: "asc" }],
  });

  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.title || !body?.body) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const title = String(body.title).trim();
  const key = await uniqueSlug(title, async (slug) => {
    const found = await prisma.messageTemplate.findUnique({
      where: { key_locale: { key: slug, locale: "es" } },
    });
    return !!found;
  });

  const template = await prisma.messageTemplate.create({
    data: {
      key,
      title,
      locale: String(body.locale ?? "es").trim(),
      body: String(body.body),
      productKind: body.productKind
        ? (body.productKind as ProductKind)
        : null,
    },
  });

  await writeAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "MessageTemplate",
    entityId: template.id,
  });

  return NextResponse.json({ template });
}

export async function PATCH(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!canManageTeam(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const template = await prisma.messageTemplate.update({
    where: { id: body.id },
    data: {
      title: body.title !== undefined ? String(body.title).trim() : undefined,
      body: body.body !== undefined ? String(body.body) : undefined,
      locale: body.locale !== undefined ? String(body.locale) : undefined,
      productKind:
        body.productKind !== undefined
          ? body.productKind
            ? (body.productKind as ProductKind)
            : null
          : undefined,
    },
  });

  await writeAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "MessageTemplate",
    entityId: template.id,
    changes: body,
  });

  return NextResponse.json({ template });
}
