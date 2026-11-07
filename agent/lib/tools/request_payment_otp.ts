import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { requestPaymentOtp } from "@/lib/auth/payment-otp";
import { getStaffById } from "@/lib/crm/staff";
import { requireManualPaymentStaff, getCallerStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Send a one-time verification code to the business owner's inbox, required before record_manual_payment. Call this first, then ask the operator to relay the code they were given out-of-band once they have it.",
  inputSchema: z.object({
    enrollmentId: z.string().min(1),
    context: z.string().max(200).optional().describe("Short human-readable context, e.g. contact name / amount"),
  }),
  approval: always(),
  async execute({ enrollmentId, context }, ctx) {
    requireManualPaymentStaff(ctx);
    const { staffId } = getCallerStaff(ctx);
    const staff = await getStaffById(staffId);
    const result = await requestPaymentOtp({
      staffUserId: staffId,
      staffName: staff?.displayName ?? "Staff",
      enrollmentId,
      context,
    });
    if (!result.ok) {
      throw new Error(
        result.error === "rate_limited"
          ? "Demasiados códigos solicitados recientemente. Espera unos minutos."
          : "No se pudo enviar el código de verificación."
      );
    }
    return { sent: true, expiresInMinutes: 10 };
  },
});
