import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import PagarShell from "@/app/components/pagar/PagarShell";
import PaymentLinkCheckout from "@/app/components/pagar/PaymentLinkCheckout";
import {
  markPaymentLinkOpened,
  resolvePaymentLink,
} from "@/lib/crm/payment-links";
import { providerForCurrency } from "@/lib/crm/custom-payment-rules";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

/**
 * El nombre con el que saluda la página, o nada.
 *
 * Una ficha creada con teléfono pero sin nombre guarda el número como nombre,
 * y la página decía «Hola, +573005550199». Mejor el saludo genérico que
 * saludar a alguien por su teléfono.
 */
const greetingFor = (firstName: string | null | undefined): string | null => {
  const name = firstName?.trim();
  if (!name || /^\+?[\d\s()-]{6,}$/.test(name)) return null;
  return name;
};

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

  const { plans, contact, note, custom } = link;

  // Un enlace de monto libre se paga una sola vez. Quien vuelve a abrirlo ya
  // pagado ve que está resuelto, no un 404 que parezca que falló.
  if (custom?.paid) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-5 py-12 text-ink">
        <div className="w-full max-w-md">
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            {BRAND.name}
          </p>
          <h1 className="mt-4 font-[font2] text-3xl uppercase leading-[0.95]">
            Este pago ya está recibido
          </h1>
          <p className="mt-3 font-[font1] text-base leading-snug text-black/60">
            No tienes que hacer nada más. Si tienes alguna duda, escríbele a
            Dayana por WhatsApp.
          </p>
        </div>
      </main>
    );
  }

  return (
    <PagarShell
      plans={plans}
      // En un enlace libre la moneda es la del enlace, no la del país.
      isColombia={custom ? custom.currency === "COP" : isColombia}
      greetingName={greetingFor(contact?.firstName)}
      note={note}
      priceLabel={custom?.amountLabel}
      action={(plan) => (
        <PaymentLinkCheckout
          plan={plan}
          userCountry={userCountry}
          token={token}
          provider={
            custom ? providerForCurrency(custom.currency) : undefined
          }
        />
      )}
    />
  );
};

export default PagarPage;
