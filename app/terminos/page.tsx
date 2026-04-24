import type { Metadata } from "next";
import LegalLayout from "../components/legal/LegalLayout";
import { BRAND, SOCIAL_LINKS } from "../../lib/contact";

export const metadata: Metadata = {
  title: `Términos y condiciones — ${BRAND.name}`,
  description:
    "Términos y condiciones que regulan el uso del sitio y la contratación de terapias y cursos con Dayana Beltrán.",
};

const email = SOCIAL_LINKS.email.replace("mailto:", "");

const Page = () => (
  <LegalLayout
    eyebrow="Legal"
    title="Términos y condiciones"
    updatedAt="19 de abril de 2026"
  >
    <p>
      Al navegar este sitio y/o contratar alguno de los servicios ofrecidos por{" "}
      {BRAND.name} aceptas los siguientes términos. Léelos con atención antes
      de agendar una sesión o inscribirte en un curso.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      1. Objeto
    </h2>
    <p>
      Este sitio ofrece información y comercializa servicios de acompañamiento
      personal basados en Programación Neurolingüística (PNL): terapias 1:1 y
      cursos en vivo. No constituye un servicio médico, psicológico clínico ni
      psiquiátrico y no reemplaza tratamientos profesionales de salud mental.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      2. Servicios y precios
    </h2>
    <ul className="list-disc pl-6 space-y-2">
      <li>Terapias individuales: paquetes de 1, 3, 6, 12 y 24 sesiones.</li>
      <li>Cursos en vivo por videollamada, con cupo limitado.</li>
      <li>
        Los precios publicados son en USD y pueden variar. El precio aplicable
        es el vigente al momento del pago.
      </li>
    </ul>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      3. Pagos
    </h2>
    <p>
      Los pagos se procesan a través de proveedores externos certificados. No
      almacenamos datos de tarjetas en nuestros servidores. Una vez confirmado
      el pago recibirás el acceso correspondiente (agenda de sesiones o enlace
      al curso) al correo registrado.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      4. Cancelaciones y reprogramación
    </h2>
    <ul className="list-disc pl-6 space-y-2">
      <li>
        Terapias individuales: puedes reprogramar una sesión sin costo con al
        menos 24 horas de anticipación. Después de ese plazo la sesión se
        considerará realizada.
      </li>
      <li>
        Cursos en vivo: el acceso es personal e intransferible. El cupo no se
        reembolsa, pero puedes trasladarlo a la siguiente edición si avisas
        antes del inicio del curso.
      </li>
      <li>
        Los reembolsos solo aplican por causas imputables a {BRAND.name} (por
        ejemplo, cancelación del evento).
      </li>
    </ul>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      5. Compromiso del cliente
    </h2>
    <p>
      El trabajo con PNL requiere participación activa y honestidad durante el
      proceso. Al contratar confirmas que asistes de forma voluntaria y que la
      información compartida es verdadera. Si estás bajo tratamiento médico o
      psicológico, te recomendamos informarlo previamente.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      6. Propiedad intelectual
    </h2>
    <p>
      Los contenidos del sitio, materiales de los cursos, grabaciones, textos,
      audios, vídeos y materiales gráficos son propiedad de {BRAND.name} o de
      sus autores y están protegidos por derechos de autor. Está prohibida su
      reproducción, redistribución o uso comercial sin autorización escrita.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      7. Responsabilidad
    </h2>
    <p>
      Los resultados de cualquier proceso de PNL dependen de múltiples factores
      personales. {BRAND.name} no garantiza resultados específicos y no se hace
      responsable por decisiones que tomes como consecuencia del
      acompañamiento. El servicio no sustituye atención médica ni psicológica
      profesional.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      8. Contacto
    </h2>
    <p>
      Para cualquier consulta sobre estos términos puedes escribirnos al correo{" "}
      <a
        href={SOCIAL_LINKS.email}
        className="text-linen underline underline-offset-4"
      >
        {email}
      </a>
      .
    </p>
  </LegalLayout>
);

export default Page;
