import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { assignEnrollmentContact } from "@/lib/crm/checkout-placeholder";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Pone nombre a un pago que quedó sin identificar.
 *
 * Se entra por el id del PAGO porque es lo que ve Dayana en la lista, pero lo
 * que se mueve es la matrícula: el pago cuelga de ella y viaja con ella.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    contactId?: unknown;
  } | null;
  const contactId =
    typeof body?.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) {
    return NextResponse.json({ error: "missing_contact" }, { status: 400 });
  }

  const payment = await prisma.payment.findUnique({
    where: { id },
    select: { id: true, enrollmentId: true },
  });
  if (!payment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const result = await assignEnrollmentContact(
      payment.enrollmentId,
      contactId
    );

    fireAuditLog({
      staffUserId: staff.id,
      action: "UPDATE",
      entityType: "Enrollment",
      entityId: payment.enrollmentId,
      changes: {
        reason: "identify_payment",
        paymentId: payment.id,
        contactId: result.contactId,
        placeholderRemoved: result.placeholderRemoved,
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const code =
      e instanceof Error && "code" in e
        ? String((e as { code: string }).code)
        : null;
    if (code === "ENROLLMENT_NOT_FOUND" || code === "CONTACT_NOT_FOUND") {
      return NextResponse.json({ error: code }, { status: 404 });
    }
    throw e;
  }
}
