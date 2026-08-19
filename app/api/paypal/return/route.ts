import { NextResponse } from "next/server";
import { siteBaseUrl } from "@/lib/mercadopago/amount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retorno del flujo por redirección de PayPal.
 *
 * PayPal manda al comprador de vuelta a `?token=<orderID>&PayerID=<id>` tras
 * aprobar. Aquí se captura el pago reusando `/api/paypal/capture-order` — la
 * misma ruta que usaba el SDK incrustado, con toda su validación de importe,
 * idempotencia y fulfilment — y se redirige a `/pago/exito`.
 *
 * Es GET porque quien llega es el navegador del comprador, no PayPal: la
 * confirmación autoritativa sigue siendo el webhook firmado. Si la captura
 * falla aquí, el webhook la recoge igual; por eso nunca se muestra "falló".
 */
export async function GET(req: Request) {
  const base = siteBaseUrl();
  const url = new URL(req.url);
  const orderID = url.searchParams.get("token");

  if (!orderID) {
    return NextResponse.redirect(`${base}/pago/cancelado`, { status: 303 });
  }

  try {
    const res = await fetch(`${base}/api/paypal/capture-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderID }),
    });
    const data = (await res.json()) as {
      enrollmentId?: string;
      error?: string;
    };

    if (res.ok && data.enrollmentId) {
      return NextResponse.redirect(
        `${base}/pago/exito?enrollmentId=${encodeURIComponent(data.enrollmentId)}`,
        { status: 303 }
      );
    }

    // Capturado a medias o rechazado: el webhook es la fuente de verdad, así
    // que se manda a la página de éxito en estado "procesando" en vez de
    // declarar un fallo que quizá no lo sea.
    console.error("[paypal return] capture no concluyente", res.status, data.error);
    return NextResponse.redirect(`${base}/pago/exito?paypal=1`, { status: 303 });
  } catch (e) {
    console.error("[paypal return] error", e);
    return NextResponse.redirect(`${base}/pago/exito?paypal=1`, { status: 303 });
  }
}
