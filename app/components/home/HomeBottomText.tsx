import { buildWhatsAppUrl } from "../../../lib/contact";

const HomeBottomText = () => {
  const whatsappUrl = buildWhatsAppUrl(
    "Hola Dayana, me gustaría más información sobre las terapias de reprogramación."
  );

  return (
    <div className="font-[font2] flex flex-col lg:flex-row items-center justify-center gap-3 lg:gap-4 px-4 pb-6 lg:pb-0 relative z-10">
      <p className="hidden lg:block absolute lg:w-[20vw] lg:right-20 lg:bottom-72 font-[font1] lg:text-lg lg:leading-relaxed">
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
        Acompañamos procesos reales de reprogramación neurolingüística para que
        sueltes lo que te frena y empieces a vivir desde tu potencial. Terapias
        1:1 y cursos en vivo, con resultados que se sienten.
      </p>

      <a
        href="#testimonios"
        className="lg:border-3 border-2 hover:border-[#D3FD50] hover:text-[#D3FD50] lg:h-44 flex items-center px-3 pt-1 lg:px-14 border-white rounded-full uppercase"
      >
        <span className="text-[8vw] lg:text-[5vw] lg:mt-6">Testimonios</span>
      </a>

      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group lg:h-44 flex items-center gap-3 lg:gap-4 px-5 pt-1 lg:px-12 rounded-full uppercase bg-[#25D366] hover:bg-[#128C7E] text-white border-2 lg:border-3 border-[#25D366] hover:border-[#128C7E] transition-colors shadow-lg shadow-[#25D366]/30"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="w-7 h-7 lg:w-14 lg:h-14 lg:mt-5 shrink-0"
        >
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
        </svg>
        <span className="text-[8vw] lg:text-[5vw] lg:mt-6">WhatsApp</span>
      </a>
    </div>
  );
};

export default HomeBottomText;
