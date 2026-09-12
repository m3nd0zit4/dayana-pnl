import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import PagarShell from "@/app/components/pagar/PagarShell";
import PaymentLinkCheckout from "@/app/components/pagar/PaymentLinkCheckout";
import {
  markPaymentLinkOpened,
  resolvePaymentLink,
} from "@/lib/crm/payment-links";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

const LINK_PREVIEW_BOT_RE =
  /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedin|twitter|skype|embedly|vkshare|pinterest/i;

export const metadata: Metadata = {
  title: `Tu pago | ${BRAND.name}`,
  robots: { index: false, follow: false },
};

/**
 * El enlace de pago de UNA persona.
 *
 * Lo que lo distingue del enlace fijo del paquete (`/pagar/p/<id>`) es que
 * sabe de quién es: saluda por su nombre, puede llevar una nota, y el cobro se
 * cuelga de su ficha en vez de fabricar un contacto nuevo.
 *
 * La maqueta vive en `PagarShell`, compartida con la otra ruta.
 */
const PagarPage = async ({
  params,
}: {
  params: Promise<{ token: string }>;
}) => {
  const { token } = await params;
  const userCountry = await getServerUserCountry().catch(() => null);
  const isColombia = userCountry === "CO";

  const link = await resolvePaymentLink(token, isColombia);
  if (!link) notFound();

  // Pegar el enlace en WhatsApp o Telegram hace que su robot pida la página
  // para dibujar la vista previa, antes de que la persona lo toque. Contar esa
  // visita marcaría «abierto» un enlace que nadie abrió.
  const userAgent = (await headers()).get("user-agent") ?? "";
  if (!LINK_PREVIEW_BOT_RE.test(userAgent)) {
    await markPaymentLinkOpened(token);
  }

  const { plan, contact, note } = link;
  return (
    <PagarShell
      plan={plan}
      isColombia={isColombia}
      greetingName={contact?.firstName ?? null}
      note={note}
      action={
        <PaymentLinkCheckout
          plan={plan}
          userCountry={userCountry}
          token={token}
        />
      }
    />
  );
};

export default PagarPage;
