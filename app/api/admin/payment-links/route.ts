import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createPaymentLink,
  listPaymentLinksForContact,
  listRecentPaymentLinks,
  resolvePaymentLinkBuyer,
  revokePaymentLink,
} from "@/lib/crm/payment-links";

export const dynamic = "force-dynamic";

/**
 * Tres formas validas, y la tercera es el punto:
 *
 *  - `contactId` de una ficha que ya existe
 *  - `buyer` con nombre y telefono O correo, que se da de alta al crear
 *  - ninguno de los dos: el enlace se crea igual
 *
 * Exigir la ficha antes de poder cobrar era la limitacion que costaba ventas.
 * Un enlace sin contacto sigue el camino anonimo normal del sitio.
 */
const createSchema = z.object({
  contactId: z.string().min(1).optional(),
  buyer: z
    .object({
      firstName: z.string().trim().max(120).optional(),
      lastName: z.string().trim().max(120).optional(),
      phone: z.string().trim().max(30).optional(),
      phoneCountry: z.string().trim().max(2).optional(),
      email: z.string().trim().email().max(200).optional(),
    })
    .optional(),
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
    // El formulario necesita saber QUÉ campo falla, no sólo que algo falló.
    const field = String(parsed.error.issues[0]?.path.at(-1) ?? "");
    const error =
      field === "email"
        ? "invalid_email"
        : field === "phone"
          ? "invalid_phone"
          : field === "expiresInDays"
            ? "invalid_expiry"
            : field === "productId"
              ? "missing_product"
              : "invalid_request";
    return NextResponse.json({ error }, { status: 400 });
  }

  // Un nombre sin teléfono ni correo no identifica a nadie: antes se descartaba
  // en silencio y salía un enlace abierto que parecía personal. Y un teléfono
  // o correo sin nombre dejaba la ficha —y el saludo— con el número.
  const buyer = parsed.data.buyer;
  const buyerHasName = Boolean(buyer?.firstName?.trim());
  const buyerHasReach = Boolean(buyer?.phone?.trim() || buyer?.email?.trim());
  if (!parsed.data.contactId && buyerHasName && !buyerHasReach) {
    return NextResponse.json({ error: "missing_contact_data" }, { status: 400 });
  }
  if (!parsed.data.contactId && buyerHasReach && !buyerHasName) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }

  try {
    const { contactId, buyer, ...rest } = parsed.data;
    // La ficha escrita a mano se resuelve AL CREAR el enlace, no al pagar: asi
    // el enlace ya sale con dueno y el cobro se le cuelga directo.
    const resolvedContactId =
      contactId ?? (await resolvePaymentLinkBuyer(buyer));

    const link = await createPaymentLink({
      ...rest,
      contactId: resolvedContactId,
      staffUserId: staff.id,
    });

    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "PaymentLink",
      entityId: link.id,
      changes: { productId: link.product.id, contactId: link.contact?.id ?? null },
    });

    return NextResponse.json({ link });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "INVALID_PHONE") {
      return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
    }
    console.error("[payment-links] create failed", message);
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
