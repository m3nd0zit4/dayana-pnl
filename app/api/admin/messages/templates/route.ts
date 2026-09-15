import { NextResponse } from "next/server";
import { ProductKind } from "@prisma/client";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { canManageTeam } from "@/lib/crm/staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { isQuickMessageTemplate } from "@/lib/crm/quick-message-templates";
import { uniqueSlug } from "@/lib/crm/slug";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () => {
  const templates = await prisma.messageTemplate.findMany({
    orderBy: [{ key: "asc" }, { locale: "asc" }],
  });

  return NextResponse.json({ templates });
});

export const POST = withStaff("write", async ({ req, staff }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const body = await readJson(req);
  if (!body?.title || !body?.body) {
    return apiError("missing_fields", 400);
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

  fireAuditLog({
    staffUserId: staff.id,
    action: "CREATE",
    entityType: "MessageTemplate",
    entityId: template.id,
  });

  return NextResponse.json({ template });
});

export const PATCH = withStaff("write", async ({ req, staff }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const body = await readJson(req);
  if (!body?.id) {
    return apiError("missing_fields", 400);
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

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "MessageTemplate",
    entityId: template.id,
    changes: body,
  });

  return NextResponse.json({ template });
});

export const DELETE = withStaff("write", async ({ req, staff }) => {
  if (!canManageTeam(staff.role)) {
    return apiError("forbidden", 403);
  }

  const body = await readJson(req);
  const id = typeof body?.id === "string" ? body.id : undefined;
  if (!id) {
    return apiError("missing_fields", 400);
  }

  const existing = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!existing) {
    return apiError("not_found", 404);
  }

  if (!isQuickMessageTemplate(existing.key)) {
    return apiError("system_template", 403);
  }

  await prisma.messageTemplate.delete({ where: { id } });

  fireAuditLog({
    staffUserId: staff.id,
    action: "DELETE",
    entityType: "MessageTemplate",
    entityId: id,
    changes: { key: existing.key, title: existing.title },
  });

  return NextResponse.json({ ok: true });
});
