import { requirePortalContext } from "@/lib/lms/portal";
import NotificationTogglesForm from "@/app/components/shared/settings/NotificationTogglesForm";
import { Card, CardContent } from "@/app/components/ui/card";

const Page = async () => {
  const { contact } = await requirePortalContext();

  return (
    <Card>
      <CardContent>
        <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
          Notificaciones
        </h2>
        <div className="mt-4 max-w-xl">
          <NotificationTogglesForm
            saveUrl="/api/miembros/perfil/notificaciones"
            items={[
              {
                key: "notifyEmail",
                label: "Correo",
                description: "Confirmaciones de pago, recordatorios y avisos por email.",
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
                label: "Notificaciones en el portal",
                description:
                  "Avisos dentro del portal, en la campana. No salen de la plataforma.",
                checked: contact.notifyInApp,
              },
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default Page;
