import CuentaSection from "@/app/components/cuenta/CuentaSection";
import NotificationTogglesForm from "@/app/components/shared/settings/NotificationTogglesForm";
import { requirePortalContext } from "@/lib/lms/portal";

const Page = async () => {
  const { contact } = await requirePortalContext();

  return (
    <CuentaSection
      title="Por dónde te avisamos"
      description="Los pagos y los accesos se confirman siempre por correo; lo demás lo eliges tú."
    >
      <NotificationTogglesForm
        saveUrl="/api/miembros/perfil/notificaciones"
        items={[
          {
            key: "notifyEmail",
            label: "Correo",
            description:
              "Confirmaciones de pago, recordatorios y avisos por email.",
            checked: contact.notifyEmail,
          },
          {
            key: "notifySms",
            label: "SMS",
            description: "Avisos importantes por mensaje de texto.",
            checked: contact.notifySms,
          },
          {
            key: "notifyWhatsapp",
            label: "WhatsApp",
            description: "Recordatorios y avisos por WhatsApp.",
            checked: contact.notifyWhatsapp,
          },
          {
            key: "notifyInApp",
            label: "Dentro del curso",
            description:
              "Avisos en la campana, mientras estudias. No salen de la plataforma.",
            checked: contact.notifyInApp,
          },
        ]}
      />
    </CuentaSection>
  );
};

export default Page;
