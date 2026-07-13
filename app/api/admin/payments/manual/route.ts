import { NextRequest, NextResponse } from "next/server";
import { PaymentProvider, PaymentStatus } from "@prisma/client";
import { requireManualPaymentStaff } from "@/lib/auth/api-staff";
import { consumePaymentOtp, peekPaymentOtp } from "@/lib/auth/payment-otp";
import { fireAuditLog } from "@/lib/crm/audit";
import { prisma } from "@/lib/db";
import { recordPayment } from "@/lib/crm/payments";
import { manualPaymentSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const staff = await requireManualPaymentStaff();
  if (staff instanceof NextResponse) return staff;

  const raw = await req.json().catch(() => null);
  const parsed = manualPaymentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const otp = await peekPaymentOtp({
    staffUserId: staff.id,
    code: parsed.data.code,
  });
  if (!otp.ok) {
    return NextResponse.json({ error: otp.error }, { status: 400 });
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: parsed.data.enrollmentId },
    select: { amountMinor: true, currency: true },
  });
  if (!enrollment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (
    enrollment.amountMinor != null &&
    enrollment.currency === parsed.data.currency &&
    parsed.data.amountMinor > enrollment.amountMinor
  ) {
    return NextResponse.json(
      { error: "AMOUNT_EXCEEDS_SERVICE_PRICE", maxAmountMinor: enrollment.amountMinor },
      { status: 400 }
    );
  }

  const providerPaymentId =
    parsed.data.providerPaymentId ??
    `manual-${parsed.data.enrollmentId}-${Date.now()}`;

  try {
    const payment = await recordPayment({
      enrollmentId: parsed.data.enrollmentId,
      provider: PaymentProvider.MANUAL,
      providerPaymentId,
      providerOrderId: parsed.data.reference?.trim().slice(0, 120),
      status: PaymentStatus.APPROVED,
      currency: parsed.data.currency,
      amountMinor: parsed.data.amountMinor,
      paidAt: new Date(),
    });

    await consumePaymentOtp(staff.id);

    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "Payment",
      entityId: payment.id,
      changes: parsed.data,
    });

    return NextResponse.json({ payment });
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String((e as { code: string }).code) : null;
    if (code === "ACTIVE_THERAPY_EXISTS") {
      return NextResponse.json({ error: code }, { status: 400 });
    }
    throw e;
  }
}
