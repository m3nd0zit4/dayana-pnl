import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AgendaBooking from "@/app/components/agenda/AgendaBooking";
import RevealScope from "@/app/components/common/RevealScope";
import { getBookingConfig, listAvailableSlots } from "@/lib/crm/booking";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Agenda tu cita | ${BRAND.name}`,
  description: "Reserva tu espacio con Dayana Beltrán.",
  alternates: { canonical: "/agenda" },
};

/**
 * La agenda pública.
 *
 * Los huecos se calculan aquí, en el servidor, contra el Google Calendar de
 * Dayana: lo que se ve libre está libre de verdad, no es una copia que se
 * desactualiza. Con la agenda apagada la ruta responde 404 en vez de ofrecer
 * horas que nadie atiende.
 */
const AgendaPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ de?: string }>;
}) => {
  const { de } = await searchParams;
  const config = await getBookingConfig();
  if (!config.isActive) notFound();

  const timezone = await getOperationalTimezone();
  const days = await listAvailableSlots(config, timezone);

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-5 py-12 text-ink">
      <RevealScope className="w-full max-w-xl" selector=".reveal" y={24} step={0}>
        <div className="reveal">
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            {BRAND.name}
          </p>

          <h1 className="mt-4 font-[font2] text-3xl uppercase leading-[0.95]">
            {config.title}
          </h1>

          {config.description && (
            <p className="mt-3 font-[font1] text-base leading-snug text-black/60">
              {config.description}
            </p>
          )}

          <p className="mt-2 font-[font1] text-sm text-black/45">
            Dura {config.durationMinutes} minutos. Horas en{" "}
            {timezone.split("/").at(-1)?.replace(/_/g, " ") ?? timezone}.
          </p>

          <AgendaBooking days={days} timezone={timezone} source={de} />
        </div>
      </RevealScope>
    </main>
  );
};

export default AgendaPage;
