import type { Metadata } from "next";
import LegalLayout from "../components/legal/LegalLayout";
import { BRAND, SOCIAL_LINKS } from "../../lib/contact";

export const metadata: Metadata = {
  title: `Política de cookies — ${BRAND.name}`,
  description:
    "Información sobre el uso de cookies y tecnologías similares en el sitio de Dayana Beltrán.",
};

const email = SOCIAL_LINKS.email.replace("mailto:", "");

const Page = () => (
  <LegalLayout
    eyebrow="Legal"
    title="Política de cookies"
    updatedAt="19 de abril de 2026"
  >
    <p>
      Esta política explica qué son las cookies y cómo las utilizamos en el
      sitio de {BRAND.name}. Al continuar navegando aceptas el uso de cookies
      descrito a continuación.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      1. ¿Qué son las cookies?
    </h2>
    <p>
      Las cookies son pequeños archivos de texto que los sitios web almacenan
      en tu dispositivo para reconocerte en visitas posteriores, mejorar tu
      experiencia y obtener información sobre cómo se usa el sitio.
    </p>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      2. Cookies que utilizamos
    </h2>
    <ul className="list-disc pl-6 space-y-2">
      <li>
        <strong className="text-white">Esenciales:</strong> necesarias para el
        funcionamiento básico del sitio (por ejemplo, recordar preferencias de
        navegación durante la sesión). No se pueden desactivar.
      </li>
      <li>
        <strong className="text-white">Analítica (opcional):</strong> cuando
        habilitemos herramientas de medición anónima, se usarán cookies de
        rendimiento para entender qué contenido resulta relevante. No se
        recogen datos que permitan identificarte.
      </li>
      <li>
        <strong className="text-white">Terceros incrustados:</strong> al
        reproducir videos de YouTube u otros servicios embebidos, el proveedor
        externo puede establecer sus propias cookies conforme a sus políticas.
      </li>
    </ul>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      3. Gestión de cookies
    </h2>
    <p>
      Puedes configurar tu navegador para aceptar, bloquear o eliminar cookies
      desde los ajustes de privacidad. Ten en cuenta que bloquear cookies
      esenciales podría afectar el funcionamiento del sitio. Guías oficiales
      por navegador:
    </p>
    <ul className="list-disc pl-6 space-y-2">
      <li>
        <a
          href="https://support.google.com/chrome/answer/95647"
          target="_blank"
          rel="noopener noreferrer"
          className="text-linen underline underline-offset-4"
        >
          Google Chrome
        </a>
      </li>
      <li>
        <a
          href="https://support.mozilla.org/es/kb/habilitar-y-deshabilitar-cookies-sitios-web-rastrear-preferencias"
          target="_blank"
          rel="noopener noreferrer"
          className="text-linen underline underline-offset-4"
        >
          Mozilla Firefox
        </a>
      </li>
      <li>
        <a
          href="https://support.apple.com/es-es/guide/safari/sfri11471/mac"
          target="_blank"
          rel="noopener noreferrer"
          className="text-linen underline underline-offset-4"
        >
          Apple Safari
        </a>
      </li>
      <li>
        <a
          href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-las-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09"
          target="_blank"
          rel="noopener noreferrer"
          className="text-linen underline underline-offset-4"
        >
          Microsoft Edge
        </a>
      </li>
    </ul>

    <h2 className="font-[font2] uppercase text-xl lg:text-2xl text-white pt-4">
      4. Cambios en esta política
    </h2>
    <p>
      Actualizaremos esta política cuando cambien las cookies que utilizamos o
      cuando la normativa lo requiera. La fecha de la última actualización se
      muestra al inicio del documento. Si tienes dudas, escríbenos a{" "}
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
