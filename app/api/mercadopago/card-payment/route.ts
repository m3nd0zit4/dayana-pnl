import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getPlan, isPlanId } from "../../../../lib/plans";

type Body = {
  planId?: string;
  token?: string;
  payment_method_id?: string;
  paymentMethodId?: string;
  issuer_id?: string | null;
  issuerId?: string | null;
  installments?: number | string;
  transaction_amount?: number | string;
  payer?: {
    email?: string;
    identification?: {
      type?: string;
      number?: string;
    };
  };
};

export async function POST(req: Request) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token?.trim()) {
    return NextResponse.json(
      { ok: false, message: "Falta MERCADOPAGO_ACCESS_TOKEN." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Body JSON inválido." },
      { status: 400 }
    );
  }

  if (!body.planId || !isPlanId(body.planId)) {
    return NextResponse.json(
      { ok: false, message: "Plan inválido." },
      { status: 400 }
    );
  }
  const paymentMethodId = body.payment_method_id ?? body.paymentMethodId;
  const issuerId = body.issuer_id ?? body.issuerId;
  if (!body.token || !paymentMethodId) {
    return NextResponse.json(
      { ok: false, message: "Faltan datos de tarjeta/token." },
      { status: 400 }
    );
  }

  const installmentsRaw = Number(body.installments);
  const installments = Number.isFinite(installmentsRaw) && installmentsRaw > 0
    ? Math.trunc(installmentsRaw)
    : 1;

  const plan = getPlan(body.planId);
  const email = body.payer?.email?.trim();
  if (!email) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Falta el email del pagador. Es obligatorio para procesar tarjeta en Mercado Pago.",
      },
      { status: 400 }
    );
  }

  const transactionAmountRaw =
    Number(body.transaction_amount) > 0
      ? Number(body.transaction_amount)
      : plan.amountUsd;

  const identificationType = body.payer?.identification?.type?.trim();
  const identificationNumber = body.payer?.identification?.number?.trim();

  const paymentBody = {
    token: body.token,
    transaction_amount: transactionAmountRaw,
    installments,
    payment_method_id: paymentMethodId,
    issuer_id: issuerId ?? undefined,
    description: `${plan.title} - ${plan.sessions}`,
    external_reference: plan.id,
    payer: {
      email,
      identification: {
        type: identificationType ?? "",
        number: identificationNumber ?? "",
      },
    },
  };

  try {
    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(paymentBody),
    });

    const data = (await mpRes.json()) as {
      id?: number;
      status?: string;
      status_detail?: string;
      message?: string;
    };

    if (!mpRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          message:
            data.message ?? "No se pudo procesar el pago con tarjeta.",
          detail: data.status_detail,
        },
        { status: 502 }
      );
    }

    const approved = data.status === "approved";
    return NextResponse.json({
      ok: approved,
      approved,
      paymentId: data.id,
      status: data.status,
      statusDetail: data.status_detail,
      message: approved
        ? "Pago aprobado."
        : "Pago recibido y en validación.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error de red con Mercado Pago.";
    return NextResponse.json({ ok: false, message }, { status: 502 });
  }
}
