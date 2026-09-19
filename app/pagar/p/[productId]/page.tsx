import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentSlugForPrevious } from "@/lib/crm/workshop-editions";

import PagarShell from "@/app/components/pagar/PagarShell";
import PaymentLinkCheckout from "@/app/components/pagar/PaymentLinkCheckout";
import { resolveDefaultProductLink } from "@/lib/crm/payment-links";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Tu pago | ${BRAND.name}`,
  /**
   * Igual que el enlace con token: fuera de los buscadores y fuera del
   * sitemap. No es una página de catálogo — no argumenta, no compara y no
   * intenta convencer a nadie. Que Google la indexara sería mandar a
   * desconocidos a una pantalla que da por hecho que la conversación ya
   * ocurrió.
   */
  robots: { index: false, follow: false },
};

/**
 * El enlace FIJO de un paquete.
 *
 * Se copia desde la tarjeta en Paquetes y sirve para cualquiera que lo reciba:
 * no caduca, no se revoca y no lleva contacto. Cada quien que pague desde aquí
 * recibe su propia ficha, reconciliada con el correo y el teléfono que escriba
 * en el checkout.
 *
 * La ruta usa el id del producto directamente porque **ya es legible**
 * (`therapy-6`, `course-live`): no hay columna `slug` en `Product` y no hace
 * falta inventarla. `dayanabeltran.com/pagar/p/therapy-6` se lee y se dicta.
 */
const PagarProductoPage = async ({
  params,
}: {
  params: Promise<{ productId: string }>;
}) => {
  const { productId } = await params;
  const userCountry = await getServerUserCountry().catch(() => null);
  const isColombia = userCountry === "CO";

  /*
    Las mismas puertas que el enlace con token, y por la misma función: un
    paquete retirado, un contenedor de curso de la biblioteca o un producto sin
    precio en la moneda de quien mira dan 404. Sin eso se publicaría un botón
    que revienta al llegar al checkout.
  */
  const resolved = await resolveDefaultProductLink(productId, isColombia);
  if (!resolved && productId.startsWith("taller-")) {
    // El taller cambio de URL (y su producto de id): el enlace fijo viejo
    // lleva al nuevo en vez de dar 404.
    const renamedTo = await currentSlugForPrevious(productId.slice("taller-".length));
    if (renamedTo) redirect(`/pagar/p/taller-${renamedTo}`);
  }
  if (!resolved) notFound();

  return (
    <PagarShell
      plan={resolved.plan}
      isColombia={isColombia}
      action={
        <PaymentLinkCheckout plan={resolved.plan} userCountry={userCountry} />
      }
    />
  );
};

export default PagarProductoPage;
