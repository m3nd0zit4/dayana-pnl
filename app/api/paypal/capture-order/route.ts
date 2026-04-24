import { NextRequest, NextResponse } from "next/server";
import {
  capturePayPalOrderRequest,
  getPayPalAccessToken,
} from "../../../../lib/paypal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { orderID?: unknown };

/** PayPal order IDs are alphanumeric; keep validation loose but safe. */
const isLikelyOrderId = (value: string): boolean =>
  /^[A-Za-z0-9_-]{10,64}$/.test(value);

const extractCaptureId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as {
    purchase_units?: Array<{
      payments?: { captures?: Array<{ id?: string }> };
    }>;
  };
  const captures = p.purchase_units?.[0]?.payments?.captures;
  return captures?.[0]?.id;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Body inválido" },
      { status: 400 }
    );
  }

  const orderID =
    typeof body.orderID === "string" ? body.orderID.trim() : "";
  if (!orderID || !isLikelyOrderId(orderID)) {
    return NextResponse.json(
      { error: "invalid_order", message: "Orden de PayPal inválida" },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getPayPalAccessToken();
    const result = await capturePayPalOrderRequest(accessToken, orderID);
    const captureId = extractCaptureId(result);
    const status =
      typeof result === "object" &&
      result !== null &&
      "status" in result &&
      typeof (result as { status: unknown }).status === "string"
        ? (result as { status: string }).status
        : "COMPLETED";

    return NextResponse.json({
      ok: true,
      orderID,
      captureId,
      status,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[paypal] capture-order failed", message);
    return NextResponse.json(
      {
        error: "paypal_error",
        message:
          "No pudimos confirmar el pago en PayPal. Si ves un cargo, contáctanos por WhatsApp con el correo de PayPal.",
      },
      { status: 500 }
    );
  }
}
