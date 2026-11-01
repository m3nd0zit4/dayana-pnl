import { NextRequest, NextResponse } from "next/server";
import { requireManualPaymentStaff } from "@/lib/auth/api-staff";
import { requestPaymentOtp } from "@/lib/auth/payment-otp";
import { paidWorkshopPaymentFor } from "@/lib/crm/payments";
import { prisma } from "@/lib/db";
import { requestPaymentOtpSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const staff = await requireManualPaymentStaff();
  if (staff instanceof NextResponse) return staff;

  const raw = await req.json().catch(() => null);
  const parsed = requestPaymentOtpSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: parsed.data.enrollmentId },
    include: { product: true, contact: true },
  });
  if (!enrollment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Antes de mandar el código: ese taller ya está pagado (por el enlace, casi siempre).
  if (!parsed.data.allowDuplicate) {
    const paid = await paidWorkshopPaymentFor(enrollment.id);
    if (paid) return NextResponse.json({ error: "ALREADY_PAID", paidWith: paid }, { status: 409 });
  }

  const result = await requestPaymentOtp({
    staffUserId: staff.id,
    staffName: staff.displayName,
    enrollmentId: enrollment.id,
    context: `${enrollment.product.title} · ${enrollment.contact.firstName}`,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
