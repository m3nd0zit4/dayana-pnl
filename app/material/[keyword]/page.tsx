import type { Metadata } from "next";
import { notFound } from "next/navigation";

import MaterialClaimForm from "@/app/components/material/MaterialClaimForm";
import RevealScope from "@/app/components/common/RevealScope";
import { getActiveMagnet } from "@/lib/crm/magnets";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Tu material | ${BRAND.name}`,
  /**
   * Fuera de los buscadores, igual que las páginas de pago: a esto se llega
   * por el comentario de un video, no navegando. Indexarla sería mandar
   * desconocidos a una entrega que no les prometieron.
   */
  robots: { index: false, follow: false },
};

/**
 * La página a la que lleva «comenta ÉXITO y te mando el material».
 *
 * TikTok no permite responder comentarios ni mensajes por API, así que la
 * respuesta la pega una persona con el enlace de esta página. De aquí en
 * adelante todo es automático: deja nombre y correo, abre el material y queda
 * en el CRM como lead, con la palabra que usó.
 */
const MaterialPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ keyword: string }>;
  searchParams: Promise<{ de?: string }>;
}) => {
  const { keyword } = await params;
  const { de } = await searchParams;
  const magnet = await getActiveMagnet(keyword);
  if (!magnet) notFound();

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-5 py-12 text-ink">
      <RevealScope className="w-full max-w-md" selector=".reveal" y={24} step={0}>
        <div className="reveal">
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            {BRAND.name}
          </p>

          <p className="mt-4 font-[font1] text-sm uppercase tracking-[0.2em] text-black/45">
            Escribiste «{magnet.label}»
          </p>

          <h1 className="mt-2 font-[font2] text-3xl uppercase leading-[0.95]">
            {magnet.title}
          </h1>

          {magnet.description && (
            <p className="mt-3 font-[font1] text-base leading-snug text-black/60">
              {magnet.description}
            </p>
          )}

          <MaterialClaimForm keyword={magnet.keyword} source={de ?? "tiktok"} />
        </div>
      </RevealScope>
    </main>
  );
};

export default MaterialPage;
