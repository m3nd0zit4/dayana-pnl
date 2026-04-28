import { NextResponse } from "next/server";
import { getPlan, isPlanId, type PlanId } from "../../../../lib/plans";
import {
  mercadoPagoItemAmount,
  siteBaseUrl,
} from "../../../../lib/mercadopago/amount";

type Body = {
  planId?: string;
  /** full = todos los medios; cards = binary_mode (pago en línea con tarjeta) */
  mode?: "full" | "cards";
};

export async function POST(req: Request) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token?.trim()) {
    return NextResponse.json(
      { error: "missing_mercadopago_token" },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const planId = body.planId;
  if (!planId || !isPlanId(planId)) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const mode = body.mode === "cards" ? "cards" : "full";
  const plan = getPlan(planId as PlanId);

  let net: number;
  let fee: number;
  let currency_id: string;
  try {
    ({ net, fee, currency_id } = mercadoPagoItemAmount(plan));
  } catch (e) {
    const message = e instanceof Error ? e.message : "amount_error";
    console.error("[mercadopago] amount", message);
    return NextResponse.json({ error: "config" }, { status: 500 });
  }

  const base = siteBaseUrl();
  const title = `${plan.title} — ${plan.sessions}`;
  const allowAutoReturn = /^https:\/\//i.test(base) && !/localhost/i.test(base);

  const items: Array<Record<string, unknown>> = [
    {
      title,
      quantity: 1,
      unit_price: net,
      currency_id,
    },
  ];
  if (fee > 0) {
    items.push({
      title: "Comisión de procesamiento",
      quantity: 1,
      unit_price: fee,
      currency_id,
    });
  }

  const preferenceBody: Record<string, unknown> = {
    items,
    external_reference: planId,
    back_urls: {
      success: `${base}/pago/exito`,
      failure: `${base}/pago/cancelado`,
      pending: `${base}/pago/exito`,
    },
    statement_descriptor: "DAYANA PNL",
    binary_mode: mode === "cards",
  };
  if (allowAutoReturn) {
    preferenceBody.auto_return = "approved";
  }

  try {
    const res = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(preferenceBody),
      }
    );

    const data = (await res.json()) as {
      init_point?: string;
      sandbox_init_point?: string;
      message?: string;
    };

    if (!res.ok) {
      console.error("[mercadopago] preference failed", res.status, data);
      return NextResponse.json(
        { error: "preference_failed", detail: data.message },
        { status: 502 }
      );
    }

    const isTestToken = token.trim().startsWith("TEST-");
    const init_point =
      isTestToken && data.sandbox_init_point
        ? data.sandbox_init_point
        : data.init_point;

    if (!init_point) {
      return NextResponse.json({ error: "no_init_point" }, { status: 502 });
    }

    return NextResponse.json({ init_point, mode });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[mercadopago] preference exception", message);
    return NextResponse.json({ error: "network" }, { status: 502 });
  }
}
