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
 * confirmación autoritativa sigue siendo el webhook firmado. Una captura
 * indeterminada la recoge el webhook, así que ahí se muestra "en proceso".
 *
 * Un RECHAZO es otra cosa y sí se muestra: si el banco dijo que no, ningún
 * webhook va a cambiarlo, y callarlo dejaba a la clienta creyendo que había
 * pagado.
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
      outcome?: string;
      code?: string;
    };

    if (res.ok && data.enrollmentId) {
      return NextResponse.redirect(
        `${base}/pago/exito?enrollmentId=${encodeURIComponent(data.enrollmentId)}`,
        { status: 303 }
      );
    }

    /**
     * Un rechazo definitivo NO va a la pantalla de éxito.
     *
     * Aquí es donde una clienta con la tarjeta rechazada por su banco acababa
     * leyendo «se está procesando tu pago», y sólo se supo el motivo llamando a
     * PayPal. «En proceso» se reserva ahora para lo que de verdad puede
     * resolverse solo — una captura no concluyente que el webhook recogerá.
     */
    if (data.outcome === "rejected") {
      const query = data.code
        ? `?code=${encodeURIComponent(data.code)}&provider=paypal`
        : "?provider=paypal";
      console.error("[paypal return] pago rechazado", data.code);
      return NextResponse.redirect(`${base}/pago/fallido${query}`, {
        status: 303,
      });
    }

    console.error("[paypal return] capture no concluyente", res.status, data.error);
    return NextResponse.redirect(`${base}/pago/exito?paypal=1`, { status: 303 });
  } catch (e) {
    // Fallo de red al hablar con nuestra propia ruta: eso sí es indeterminado,
    // y el webhook sigue siendo la red de seguridad.
    console.error("[paypal return] error", e);
    return NextResponse.redirect(`${base}/pago/exito?paypal=1`, { status: 303 });
  }
}
