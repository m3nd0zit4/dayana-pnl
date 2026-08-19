"use client";

import PlanCheckoutButtons from "@/app/components/payments/PlanCheckoutButtons";
import { usePayPalModal } from "@/app/context/PayPalModalContext";
import { useMercadoPagoCheckoutModal } from "@/app/context/MercadoPagoCheckoutModalContext";
import type { Plan } from "@/lib/plans";

type Props = {
  plan: Plan;
  userCountry: string | null;
  /** Token del diagnóstico, para sellar el inicio de checkout. */
  token: string;
};

/**
 * Envoltorio del botón de pago en la página de resultado.
 *
 * Existe por una sola razón: marcar `checkoutStartedAt` antes de abrir el
 * modal. Sin ese sello no se puede distinguir "leyó el resultado y se fue" de
 * "abrió el pago y no lo terminó", que son dos problemas distintos con dos
 * arreglos distintos.
 *
 * La marca es best-effort y no bloquea: si la petición falla, el pago sigue
 * abriéndose igual. Perder una métrica es barato; perder una venta no.
 */
const DiagnosticCheckout = ({ plan, userCountry, token }: Props) => {
  const { openPayPal } = usePayPalModal();
  const { openMercadoPago } = useMercadoPagoCheckoutModal();

  const handlePay = (provider: "paypal" | "mercadopago") => {
    void fetch(`/api/diagnostico/${token}/checkout`, { method: "POST" }).catch(
      () => {},
    );

    if (provider === "mercadopago") openMercadoPago(plan.id, { sessionFirst: true });
    else openPayPal(plan.id, { sessionFirst: true });
  };

  return (
    <PlanCheckoutButtons
      plan={plan}
      isDark={false}
      userCountry={userCountry}
      // La salida por WhatsApp de la página de resultado se pinta aparte, con
      // el perfil y el dolor precargados en el mensaje. La genérica del botón
      // sería un segundo enlace al mismo sitio diciendo menos.
      showWhatsApp={false}
      onPay={handlePay}
    />
  );
};

export default DiagnosticCheckout;
