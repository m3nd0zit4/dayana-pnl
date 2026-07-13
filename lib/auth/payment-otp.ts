import crypto from "crypto";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/channels/email";
import { rateLimit } from "@/lib/api/rate-limit";

// Fixed recipient by design: manual payment registration is gated behind a
// code sent to Dayana's own inbox, independent of any Contact/StaffUser
// record, so a compromised staff account alone can't approve a payment.
const VERIFICATION_EMAIL = "dianamilenabr2007@gmail.com";
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const hashCode = (code: string) =>
  crypto.createHash("sha256").update(code).digest("hex");

const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

export type RequestOtpResult =
  | { ok: true }
  | { ok: false; error: "rate_limited" | "email_failed" };

export const requestPaymentOtp = async (input: {
  staffUserId: string;
  staffName: string;
  enrollmentId?: string;
  context?: string;
}): Promise<RequestOtpResult> => {
  const rl = rateLimit(`payment-otp-send:${input.staffUserId}`, 3, 10 * 60_000);
  if (!rl.ok) return { ok: false, error: "rate_limited" };

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await prisma.$transaction([
    prisma.paymentVerificationCode.updateMany({
      where: { staffUserId: input.staffUserId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.paymentVerificationCode.create({
      data: {
        codeHash: hashCode(code),
        email: VERIFICATION_EMAIL,
        staffUserId: input.staffUserId,
        enrollmentId: input.enrollmentId ?? null,
        expiresAt,
      },
    }),
  ]);

  try {
    await sendEmail({
      to: VERIFICATION_EMAIL,
      subject: "Código para registrar un pago",
      html: `<p>${input.staffName} quiere registrar un pago${
        input.context ? ` (${input.context})` : ""
      } en el CRM.</p><p>Código de verificación:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>Vence en 10 minutos.</p>`,
      text: `${input.staffName} quiere registrar un pago${
        input.context ? ` (${input.context})` : ""
      } en el CRM.\n\nCódigo de verificación: ${code}\n\nVence en 10 minutos.`,
    });
  } catch (e) {
    console.error("[payment-otp] send failed", e);
    return { ok: false, error: "email_failed" };
  }

  return { ok: true };
};

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; error: "invalid_code" | "expired_code" | "too_many_attempts" };

/**
 * Checks the code but does NOT consume it — the caller may still reject the
 * payment for unrelated reasons (price cap, ACTIVE_THERAPY_EXISTS) and the
 * staff member must be able to retry with the same code rather than burning
 * it on a correct-code-but-rejected-payment attempt. Call `consumePaymentOtp`
 * only once the payment actually goes through.
 */
export const peekPaymentOtp = async (input: {
  staffUserId: string;
  code: string;
}): Promise<VerifyOtpResult> => {
  const row = await prisma.paymentVerificationCode.findFirst({
    where: { staffUserId: input.staffUserId, usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!row || row.expiresAt < new Date()) {
    return { ok: false, error: "expired_code" };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await prisma.paymentVerificationCode.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    return { ok: false, error: "too_many_attempts" };
  }

  if (hashCode(input.code.trim()) !== row.codeHash) {
    await prisma.paymentVerificationCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, error: "invalid_code" };
  }

  return { ok: true };
};

export const consumePaymentOtp = async (staffUserId: string): Promise<void> => {
  await prisma.paymentVerificationCode.updateMany({
    where: { staffUserId, usedAt: null },
    data: { usedAt: new Date() },
  });
};
