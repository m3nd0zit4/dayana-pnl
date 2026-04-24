import type { Metadata } from "next";
import LegalLayout from "../components/legal/LegalLayout";
import { BRAND, SOCIAL_LINKS, WHATSAPP_NUMBER } from "../../lib/contact";

export const metadata: Metadata = {
  title: `Aviso de privacidad — ${BRAND.name}`,
  description:
    "Política de tratamiento de datos personales de Dayana Beltrán. Conoce qué información recopilamos, con qué finalidad y tus derechos como titular.",
};

const email = SOCIAL_LINKS.email.replace("mailto:", "");

const Page = () => (
  <LegalLayout
    eyebrow="Legal"
    title="Aviso de privacidad"
    updatedAt="19 de abril de 2026"
  >
    <p>
      En {BRAND.name} (en adelante, &quot;nosotros&quot;, &quot;el
      responsable&quot;) reconocemos la importancia de proteger la información
      personal de quienes confían en nuestro trabajo de acompañamiento con
      Programación Neurolingüística (PNL). Este aviso describe cómo
      recopilamos, usamos y protegemos tus datos personales conforme a la
      legislación aplicable de protección de datos.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      1. Responsable del tratamiento
    </h2>
    <p>
      {BRAND.name}, {BRAND.tagline}. Para cualquier consulta relacionada con el
      tratamiento de tus datos puedes escribirnos al correo{" "}
      <a
        href={SOCIAL_LINKS.email}
        className="text-linen underline underline-offset-4"
      >
        {email}
      </a>{" "}
      o al WhatsApp{" "}
      <a
        href={`https://wa.me/${WHATSAPP_NUMBER.replace(/[^0-9]/g, "")}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-linen underline underline-offset-4"
      >
        {WHATSAPP_NUMBER}
      </a>
      .
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      2. Datos que recopilamos
    </h2>
    <ul className="list-disc pl-6 space-y-2">
      <li>Datos de contacto: nombre, correo electrónico y número de WhatsApp.</li>
      <li>
        Datos de facturación y pago cuando contratas una terapia o curso
        (procesados a través de proveedores externos certificados).
      </li>
      <li>
        Contenido de tus mensajes al iniciar conversación por WhatsApp o correo.
      </li>
      <li>
        Datos de navegación anónimos (páginas vistas, dispositivo) cuando
        habilitemos analítica.
      </li>
    </ul>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      3. Finalidad del tratamiento
    </h2>
    <ul className="list-disc pl-6 space-y-2">
      <li>Atender solicitudes de información sobre terapias y cursos.</li>
      <li>Agendar y gestionar sesiones individuales.</li>
      <li>Procesar pagos y emitir comprobantes.</li>
      <li>Enviar seguimiento, materiales y comunicaciones del proceso.</li>
      <li>Mejorar la experiencia del sitio y el contenido que compartimos.</li>
    </ul>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      4. Confidencialidad terapéutica
    </h2>
    <p>
      Todo lo tratado en sesión es estrictamente confidencial. No compartimos
      contenidos, nombres ni historias personales sin tu autorización expresa
      por escrito. Los testimonios publicados en el sitio se difunden
      únicamente con consentimiento previo.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      5. Conservación y seguridad
    </h2>
    <p>
      Conservamos tus datos durante el tiempo necesario para cumplir con las
      finalidades descritas o por obligaciones legales aplicables. Aplicamos
      medidas técnicas y organizativas razonables para protegerlos frente a
      accesos no autorizados, pérdida o divulgación.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      6. Tus derechos
    </h2>
    <p>
      Como titular de tus datos tienes derecho a conocer, actualizar,
      rectificar, suprimir la información y revocar el consentimiento otorgado.
      Para ejercerlos, escríbenos a{" "}
      <a
        href={SOCIAL_LINKS.email}
        className="text-linen underline underline-offset-4"
      >
        {email}
      </a>{" "}
      indicando tu solicitud. Responderemos en un plazo razonable.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      7. Cambios en esta política
    </h2>
    <p>
      Podemos actualizar este aviso cuando sea necesario. La fecha de la última
      modificación siempre estará visible al inicio del documento.
    </p>
  </LegalLayout>
);

export default Page;
