"use client";

import PlanCheckoutButtons from "@/app/components/payments/PlanCheckoutButtons";
import { useCheckoutModal } from "@/app/context/CheckoutModalContext";
import type { Plan } from "@/lib/plans";

type Props = {
  plan: Plan;
  userCountry: string | null;
  /**
   * El token del enlace personal, si lo hay.
   *
   * Ausente en el enlace fijo del paquete, y eso es justo lo que lo hace
   * seguro de compartir: sin token, la creación de la orden cae en el camino
   * anónimo y **cada compradora recibe su propia ficha**, reconciliada con el
   * correo y el teléfono que ella misma escribe.
   *
   * Con token, el cobro se cuelga de la ficha a la que Dayana mandó el enlace
   * — que es lo correcto para un enlace de una sola persona y sería un
   * desastre en uno compartido: `resolveCheckoutContactIdForPayment` resuelve
   * por el token antes de mirar los datos del formulario, así que cincuenta
   * pagos acabarían en el mismo contacto.
   */
  token?: string;
};

/**
 * El botón de una página de pago.
 *
 * Con token, sella `checkoutStartedAt` antes de abrir el modal: es lo que
 * permite distinguir «abrió el enlace y no hizo nada» de «empezó a pagar y no
 * terminó». Sin él no se sella nada — en un enlace que usan cincuenta personas
 * esa marca se pondría con la primera y mentiría sobre las demás.
 *
 * Sin salida por WhatsApp: la conversación ya ocurrió, y ofrecerla otra vez
 * aquí es devolver al punto de partida a quien ya llegó al final.
 */
const PaymentLinkCheckout = ({ plan, userCountry, token }: Props) => {
  const { openCheckout } = useCheckoutModal();

  const handlePay = (provider: "paypal" | "mercadopago") => {
    if (token) {
      void fetch(`/api/pagar/${token}/checkout`, { method: "POST" }).catch(
        () => {},
      );
    }
    openCheckout(plan.id, provider, token ? { paymentLinkToken: token } : {});
  };

  return (
    <PlanCheckoutButtons
      plan={plan}
      isDark={false}
      userCountry={userCountry}
      showWhatsApp={false}
      onPay={handlePay}
    />
  );
};

export default PaymentLinkCheckout;
