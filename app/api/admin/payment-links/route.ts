import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createPaymentLink,
  listPaymentLinksForContact,
  listRecentPaymentLinks,
  revokePaymentLink,
} from "@/lib/crm/payment-links";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  contactId: z.string().min(1),
  productId: z.string().min(1),
  note: z.string().max(400).optional(),
  // 90 días es el techo: un enlace acordado en una llamada no debería seguir
  // cobrando meses después, cuando el precio ya cambió.
  expiresInDays: z.number().int().min(1).max(90).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const contactId = req.nextUrl.searchParams.get("contactId");
  const links = contactId
    ? await listPaymentLinksForContact(contactId)
    : await listRecentPaymentLinks();

  return NextResponse.json({ links });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const link = await createPaymentLink({
      ...parsed.data,
      staffUserId: staff.id,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "PaymentLink",
      entityId: link.id,
      changes: { productId: link.product.id, contactId: link.contact.id },
    });

    return NextResponse.json({ link });
  } catch (e) {
    console.error("[payment-links] create failed", e);
    return NextResponse.json({ error: "create_failed" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  // Se revoca, no se borra: el enlace ya circuló por WhatsApp y saber que
  // existió —y cuándo dejó de valer— es parte del historial del contacto.
  await revokePaymentLink(id);

  fireAuditLog({
    staffUserId: staff.id,
    action: "REVOKE",
    entityType: "PaymentLink",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
