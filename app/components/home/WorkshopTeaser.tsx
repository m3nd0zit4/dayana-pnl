import Link from "next/link";
import type { WorkshopDetail } from "../../../lib/workshops";
import type { Plan } from "../../../lib/plans";
import PlanCheckoutButtons from "../payments/PlanCheckoutButtons";
import WhatsAppButton from "../ui/WhatsAppButton";

type WorkshopTeaserProps = {
  workshop: WorkshopDetail;
  plan: Plan | null;
  userCountry?: string | null;
};

const WorkshopTeaser = ({ workshop, plan, userCountry }: WorkshopTeaserProps) => {
  return (
    <section className="bg-[#faf7f2] text-black min-h-screen">
      <div className="px-3 lg:px-8 pt-24 lg:pt-28 pb-16 max-w-[1400px] mx-auto">
        <Link
          href="/taller-virtual"
          className="inline-flex items-center gap-2 font-[font2] text-[10px] uppercase tracking-[0.25em] text-black/55 transition-colors hover:text-black"
        >
          <span aria-hidden>←</span>
          Todos los talleres
        </Link>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-black/15 px-4 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.25em]">
            Taller virtual
          </span>
        </div>

        <h1 className="mt-7 font-[font2] text-[13vw] md:text-[9vw] lg:text-[6vw] uppercase leading-[0.92]">
          {workshop.title}
        </h1>

        <article className="mt-10 rounded-3xl border border-black/15 bg-white p-7 lg:p-10 shadow-[0_24px_60px_rgba(0,0,0,0.06)]">
          <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-black/55">
            {workshop.editionLabel}
          </div>
          <p className="font-[font1] mt-4 max-w-2xl text-base lg:text-lg leading-snug text-black/72">
            {workshop.cardSummary}
          </p>
          <div className="mt-6 rounded-2xl border border-black/12 bg-[#faf7f2] px-5 py-4">
            <div className="font-[font1] text-xl leading-tight">
              {workshop.dateLabel}
            </div>
            <div className="font-[font1] text-sm text-black/60">
              {workshop.scheduleLabel}
            </div>
          </div>
        </article>

        <article className="mt-10 rounded-3xl border border-black/10 bg-black text-white p-7 lg:p-10">
          <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-white/60">
            Inscripción
          </div>
          <p className="font-[font1] mt-4 text-white/82 leading-snug max-w-2xl text-lg">
            El programa completo se desbloquea al confirmar tu pago. Ya
            pagaste e iniciaste sesión y no ves el contenido? Escríbenos.
          </p>

          {plan ? (
            <PlanCheckoutButtons plan={plan} isDark userCountry={userCountry} />
          ) : (
            <p className="mt-6 text-sm text-white/60">
              El pago en línea para este taller aún no está configurado.
            </p>
          )}

          <div className="mt-4">
            <WhatsAppButton
              message={workshop.whatsappMessage}
              label="Consultar por WhatsApp"
              size="lg"
              className="w-full"
            />
          </div>
        </article>
      </div>
    </section>
  );
};

export default WorkshopTeaser;
