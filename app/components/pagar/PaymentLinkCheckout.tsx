"use client";

import PlanCheckoutButtons from "@/app/components/payments/PlanCheckoutButtons";
import { useCheckoutModal } from "@/app/context/CheckoutModalContext";
import type { Plan } from "@/lib/plans";

type Props = {
  plan: Plan;
  userCountry: string | null;
  token: string;
};

/**
 * El botón de un enlace de pago.
 *
 * Sella `checkoutStartedAt` antes de abrir el modal, que es lo que permite
 * distinguir "abrió el enlace y no hizo nada" de "empezó a pagar y no
 * terminó". Sin ese dato, insistirle a alguien es adivinar.
 *
 * Sin salida por WhatsApp: la conversación ya ocurrió, y ofrecerla otra vez
 * aquí es devolver al punto de partida a quien ya llegó al final.
 */
const PaymentLinkCheckout = ({ plan, userCountry, token }: Props) => {
  const { openCheckout } = useCheckoutModal();

  const handlePay = (provider: "paypal" | "mercadopago") => {
    void fetch(`/api/pagar/${token}/checkout`, { method: "POST" }).catch(
      () => {},
    );
    openCheckout(plan.id, provider);
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
