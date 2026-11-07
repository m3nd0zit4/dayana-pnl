import { PaymentProvider, PaymentStatus } from "@prisma/client";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { peekPaymentOtp, consumePaymentOtp } from "@/lib/auth/payment-otp";
import { getEnrollmentById } from "@/lib/crm/enrollments";
import { recordPayment } from "@/lib/crm/payments";
import { requireManualPaymentStaff, getCallerStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Record a manual (off-platform) payment against an enrollment — e.g. cash or a bank transfer confirmed outside PayPal/Mercado Pago. Requires a verification code from request_payment_otp, which the operator must relay after checking their email. Never guess the code.",
  inputSchema: z.object({
    enrollmentId: z.string().min(1),
    amountMinor: z.number().int().positive().describe("Minor units: cents for USD, full pesos for COP"),
    currency: z.string().length(3),
    reference: z.string().max(120).optional().describe("Bank reference / transaction note"),
    code: z.string().min(4).max(8).describe("The verification code the operator relays from request_payment_otp"),
  }),
  approval: always(),
  async execute({ enrollmentId, amountMinor, currency, reference, code }, ctx) {
    const staff = requireManualPaymentStaff(ctx);
    const { staffId } = getCallerStaff(ctx);

    const otp = await peekPaymentOtp({ staffUserId: staffId, code });
    if (!otp.ok) {
      throw new Error(
        otp.error === "expired_code"
          ? "El código expiró o no es válido. Pide uno nuevo con request_payment_otp."
          : "Demasiados intentos fallidos. Pide un código nuevo."
      );
    }

    const enrollment = await getEnrollmentById(enrollmentId);
    if (!enrollment) throw new Error("Enrollment no encontrado.");
    if (
      enrollment.amountMinor != null &&
      enrollment.currency === currency.toUpperCase() &&
      amountMinor > enrollment.amountMinor
    ) {
      throw new Error(
        `El monto (${amountMinor}) supera el precio del servicio (${enrollment.amountMinor} ${enrollment.currency}).`
      );
    }

    const providerPaymentId = `manual-agent-${enrollmentId}-${Date.now()}`;
    const payment = await recordPayment({
      enrollmentId,
      provider: PaymentProvider.MANUAL,
      providerPaymentId,
      providerOrderId: reference?.trim().slice(0, 120),
      status: PaymentStatus.APPROVED,
      currency: currency.toUpperCase(),
      amountMinor,
      paidAt: new Date(),
    });

    await consumePaymentOtp(staffId);
    await auditAgentWrite(ctx, {
      action: "CREATE",
      entityType: "Payment",
      entityId: payment.id,
      changes: { enrollmentId, amountMinor, currency, reference, staffId: staff.staffId },
    });

    return {
      payment: {
        id: payment.id,
        status: payment.status,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      },
    };
  },
});
