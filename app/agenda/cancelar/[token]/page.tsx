import type { Metadata } from "next";
import { notFound } from "next/navigation";

import RevealScope from "@/app/components/common/RevealScope";
import CancelAppointment from "@/app/components/agenda/CancelAppointment";
import { getAppointmentByCancelToken } from "@/lib/crm/booking";
import { BRAND, WHATSAPP_NUMBER } from "@/lib/contact";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Cancelar tu cita | ${BRAND.name}`,
  robots: { index: false, follow: false },
};

/**
 * Cancelar desde el enlace del correo.
 *
 * Sin sesión y sin preguntas: el token del enlace es el único secreto, y pedir
 * una cuenta para liberar un hueco acaba en un hueco que nadie libera.
 */
const CancelarPage = async ({
  params,
}: {
  params: Promise<{ token: string }>;
}) => {
  const { token } = await params;
  const appointment = await getAppointmentByCancelToken(token);
  if (!appointment) notFound();

  const when = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: appointment.timezone,
  }).format(appointment.startsAt);

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-5 py-12 text-ink">
      <RevealScope className="w-full max-w-md" selector=".reveal" y={24} step={0}>
        <div className="reveal">
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            {BRAND.name}
          </p>

          <h1 className="mt-4 font-[font2] text-3xl uppercase leading-[0.95]">
            Tu cita
          </h1>

          <p className="mt-3 font-[font1] text-lg leading-snug text-black/70">
            {when}
          </p>

          <CancelAppointment
            token={token}
            alreadyCancelled={appointment.status === "CANCELLED"}
            whatsappNumber={WHATSAPP_NUMBER}
          />
        </div>
      </RevealScope>
    </main>
  );
};

export default CancelarPage;
