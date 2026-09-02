import { parsePhoneNumberFromString } from "libphonenumber-js";

import CuentaSection from "@/app/components/cuenta/CuentaSection";
import ProfileForm from "@/app/components/miembros/ProfileForm";
import AvatarUploadField from "@/app/components/shared/settings/AvatarUploadField";
import { requirePortalContext } from "@/lib/lms/portal";

/**
 * El perfil es la raíz de `/cuenta`, no `/cuenta/general`.
 *
 * Antes «Mi cuenta» llevaba a un índice que sólo tenía enlaces a los cuatro
 * apartados: una pantalla entera para elegir entre cuatro pestañas que ya
 * están a la vista. Ahora la primera pestaña **es** la página.
 */
const Page = async () => {
  const { contact } = await requirePortalContext();

  // El teléfono puede ser un marcador de posición del alta por correo
  // (`EMAIL_SIGNUP_PLACEHOLDER_PHONE_PREFIX`), que lleva `:` y no es un número
  // real: se deja el campo vacío en vez de enseñarlo.
  const parsedPhone =
    contact.phoneE164.startsWith("+") && !contact.phoneE164.includes(":")
      ? parsePhoneNumberFromString(contact.phoneE164)
      : null;

  return (
    <>
      <CuentaSection
        title="Tu foto"
        description="Se ve en tus comentarios dentro de las clases."
      >
        <AvatarUploadField
          uploadUrl="/api/miembros/perfil/avatar"
          name={contact.displayName ?? contact.firstName}
          initialAvatarUrl={contact.avatarUrl}
        />
      </CuentaSection>

      <CuentaSection
        title="Tus datos"
        description="Con esto sabemos cómo llamarte y cómo escribirte."
      >
        <ProfileForm
          initialFirstName={contact.firstName}
          initialLastName={contact.lastName ?? ""}
          initialPhone={parsedPhone?.isValid() ? parsedPhone.number : ""}
          initialWorkDescription={contact.workDescription ?? ""}
          initialPreferredLocale={contact.preferredLocale}
        />
      </CuentaSection>
    </>
  );
};

export default Page;
