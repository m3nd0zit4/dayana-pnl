import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { listReceipts } from "@/lib/crm/whatsapp-agent/payment-info";
import { decideReceipt, dismissReceiptPayment, linkReceiptPayment, ReceiptError } from "@/lib/crm/whatsapp-agent/receipts";

export const dynamic = "force-dynamic";

/** Los comprobantes de pago de un chat (por confirmar primero). */
export const GET = withStaff("read", async ({ req }) => {
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId) return apiError("invalid_request", 400);
  return NextResponse.json({ receipts: await listReceipts(conversationId) });
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["confirm", "reject"]),
    receiptId: z.string().min(1),
    /** Lo que se le envía a la persona; vacío = nada. */
    message: z.string().trim().max(1000).optional(),
    /** «Es ese mismo pago»: la captura es del pago que la persona hizo por la página poco antes. */
    sameAsWeb: z.boolean().optional(),
  }),
  /** El pago que «Registrar pago» acaba de crear (con el código) para este comprobante. */
  z.object({ action: z.literal("link_payment"), receiptId: z.string().min(1), paymentId: z.string().min(1) }),
  /** «Ya está registrado» / «no hace falta». */
  z.object({ action: z.literal("dismiss_payment"), receiptId: z.string().min(1) }),
]);

const STATUS: Record<string, number> = { not_found: 404, payment_not_found: 404 };

/**
 * Dayana confirma un comprobante (la persona queda como contacto y clienta) o
 * lo descarta. El pago se registra después con «Registrar pago» (código de
 * verificación) y se enlaza aquí.
 */
export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_request", 400);
  const body = parsed.data;
  try {
    if (body.action === "link_payment") {
      return NextResponse.json(await linkReceiptPayment({ receiptId: body.receiptId, paymentId: body.paymentId, staffUserId: staff.id }));
    }
    if (body.action === "dismiss_payment") {
      return NextResponse.json(await dismissReceiptPayment({ receiptId: body.receiptId, staffUserId: staff.id }));
    }
    const result = await decideReceipt({
      receiptId: body.receiptId,
      decision: body.action,
      staffUserId: staff.id,
      message: body.message ?? null,
      sameAsWeb: body.action === "confirm" ? body.sameAsWeb === true : false,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ReceiptError) return apiError(e.message, STATUS[e.message] ?? 409);
    throw e;
  }
});
