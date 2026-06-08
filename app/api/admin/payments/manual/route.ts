import { NextRequest, NextResponse } from "next/server";
import { PaymentProvider, PaymentStatus } from "@prisma/client";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { writeAuditLog } from "@/lib/crm/audit";
import { recordPayment } from "@/lib/crm/payments";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => null);
  if (!body?.enrollmentId || !body?.amountMinor || !body?.currency) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const providerPaymentId =
    body.providerPaymentId ??
    `manual-${body.enrollmentId}-${Date.now()}`;

  try {
    const payment = await recordPayment({
      enrollmentId: body.enrollmentId,
      provider: PaymentProvider.MANUAL,
      providerPaymentId,
      providerOrderId:
        typeof body.reference === "string" && body.reference.trim()
          ? body.reference.trim().slice(0, 120)
          : undefined,
      status: PaymentStatus.APPROVED,
      currency: body.currency,
      amountMinor: Number(body.amountMinor),
      paidAt: new Date(),
    });

    await writeAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "Payment",
      entityId: payment.id,
      changes: body,
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
