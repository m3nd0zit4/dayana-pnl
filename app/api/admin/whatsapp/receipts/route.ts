import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { listReceipts } from "@/lib/crm/whatsapp-agent/payment-info";
import { decideReceipt, ReceiptError } from "@/lib/crm/whatsapp-agent/receipts";

export const dynamic = "force-dynamic";

/** Los comprobantes de pago de un chat (por confirmar primero). */
export const GET = withStaff("read", async ({ req }) => {
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId) return apiError("invalid_request", 400);
  return NextResponse.json({ receipts: await listReceipts(conversationId) });
});

const bodySchema = z.object({
  action: z.enum(["confirm", "reject"]),
  receiptId: z.string().min(1),
  /** Lo que se le envía a la persona; vacío = nada. */
  message: z.string().trim().max(1000).optional(),
});

/**
 * Dayana confirma un comprobante (la persona queda como contacto y clienta) o
 * lo descarta. El monto se registra después con «Registrar pago».
 */
export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_request", 400);
  try {
    const result = await decideReceipt({
      receiptId: parsed.data.receiptId,
      decision: parsed.data.action,
      staffUserId: staff.id,
      message: parsed.data.message ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ReceiptError) return apiError(e.message, e.message === "not_found" ? 404 : 409);
    throw e;
  }
});
