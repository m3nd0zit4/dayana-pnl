import Link from "next/link";
import {
  BRAND,
  WHATSAPP_NUMBER,
  buildWhatsAppUrl,
} from "@/lib/contact";

const NotFoundView = () => {
  return (
    <main className="relative min-h-screen bg-black text-white overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-80"
        style={{
          background: [
            "radial-gradient(55% 45% at 12% 8%, rgba(236,227,212,0.12), transparent 58%)",
            "radial-gradient(48% 42% at 88% 92%, rgba(237,195,177,0.14), transparent 62%)",
            "radial-gradient(40% 35% at 50% 50%, rgba(212,184,150,0.06), transparent 70%)",
          ].join(","),
        }}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 top-24 select-none font-[font2] text-[clamp(7rem,28vw,16rem)] leading-none tracking-tighter text-white/[0.04]"
      >
        404
      </div>

      <section className="relative px-4 lg:px-8 pt-36 lg:pt-44 pb-24 max-w-2xl mx-auto">
        <div className="font-[font2] uppercase text-xs tracking-[0.4em] text-linen/80 mb-5">
          {BRAND.shortName}
        </div>

        <h1 className="font-[font2] uppercase text-4xl lg:text-6xl leading-[0.95] mb-6">
          Esta pÃ¡gina
          <br />
          no existe
        </h1>

        <p className="font-[font1] text-white/75 text-base lg:text-lg leading-relaxed mb-10 max-w-lg">
          El enlace puede estar desactualizado o la ruta cambiÃ³. Vuelve al
          inicio, explora los servicios o escrÃ­benos por WhatsApp y te
          orientamos.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/"
            className="w-full sm:flex-1 rounded-full bg-linen text-black font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-white transition-colors text-center"
          >
            Ir al inicio
          </Link>
          <Link
            href="/servicios"
            className="w-full sm:flex-1 rounded-full border border-linen/30 text-white/80 font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-linen/5 hover:text-white transition-colors text-center"
          >
            Ver servicios
          </Link>
        </div>

        <a
          href={buildWhatsAppUrl(
            "Hola Dayana, estaba buscando algo en tu web y me saliÃ³ un error 404. Â¿Me puedes ayudar?"
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex w-full sm:w-auto rounded-full border border-white/10 px-6 py-3 font-[font2] uppercase text-[10px] tracking-[0.3em] text-white/60 hover:border-linen/40 hover:text-linen transition-colors justify-center"
        >
          WhatsApp
        </a>

        <p className="mt-8 font-[font1] text-[11px] text-white/40 tracking-wide">
          {WHATSAPP_NUMBER} Â· contacto@dayanabeltran.com
        </p>
      </section>
    </main>
  );
};

export default NotFoundView;
