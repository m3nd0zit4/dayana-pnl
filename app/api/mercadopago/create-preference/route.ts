import { NextResponse } from "next/server";
import { isPlanId } from "../../../../lib/plans";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import {
  mercadoPagoItemAmount,
  siteBaseUrl,
} from "../../../../lib/mercadopago/amount";
import { abandonCheckoutEnrollment } from "@/lib/crm/checkout-placeholder";
import {
  beginCheckoutEnrollment,
  mapCheckoutBeginError,
  type CheckoutContactBody,
} from "@/lib/crm/checkout-enrollment";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

type Body = CheckoutContactBody & {
  planId?: string;
  /** full = todos los medios; cards = binary_mode (pago en línea con tarjeta) */
  mode?: "full" | "cards";
};

function parseContactBody(body: Body): CheckoutContactBody {
  return {
    phone: typeof body.phone === "string" ? body.phone : undefined,
    phoneCountry:
      typeof body.phoneCountry === "string" ? body.phoneCountry : undefined,
    firstName: typeof body.firstName === "string" ? body.firstName : undefined,
    lastName: typeof body.lastName === "string" ? body.lastName : undefined,
    email: typeof body.email === "string" ? body.email : undefined,
    consentData: body.consentData === true,
    enrollmentId:
      typeof body.enrollmentId === "string" ? body.enrollmentId : undefined,
  };
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`mp:preference:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

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
  if (!planId || !isPlanId(planId) || !(await isActivePlanId(planId))) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const mode = body.mode === "cards" ? "cards" : "full";
  const plan = await getPlanFromDb(planId);
  if (!plan) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  let enrollmentId: string | undefined;
  let createdEnrollmentThisRequest = false;

  try {
    const begun = await beginCheckoutEnrollment({
      planId,
      contact: parseContactBody(body),
    });
    enrollmentId = begun.enrollmentId;
    createdEnrollmentThisRequest = begun.createdEnrollment;
  } catch (e) {
    const mapped = mapCheckoutBeginError(e);
    console.error("[mercadopago] enrollment create failed", e);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }

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

  const successUrl = `${base}/pago/exito?enrollmentId=${encodeURIComponent(enrollmentId)}`;
  const cancelUrl = `${base}/pago/cancelado?enrollmentId=${encodeURIComponent(enrollmentId)}`;

  const preferenceBody: Record<string, unknown> = {
    items,
    external_reference: enrollmentId,
    back_urls: {
      success: successUrl,
      failure: cancelUrl,
      pending: successUrl,
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
      if (createdEnrollmentThisRequest) {
        await abandonCheckoutEnrollment(enrollmentId);
      }
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
      if (createdEnrollmentThisRequest) {
        await abandonCheckoutEnrollment(enrollmentId);
      }
      return NextResponse.json({ error: "no_init_point" }, { status: 502 });
    }

    return NextResponse.json({ init_point, mode, enrollmentId });
  } catch (e) {
    if (createdEnrollmentThisRequest && enrollmentId) {
      await abandonCheckoutEnrollment(enrollmentId);
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("[mercadopago] preference exception", message);
    return NextResponse.json({ error: "network" }, { status: 502 });
  }
}
