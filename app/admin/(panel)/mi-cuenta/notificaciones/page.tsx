import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth/staff-session";
import NotificationTogglesForm from "@/app/components/shared/settings/NotificationTogglesForm";
import { Card, CardContent } from "@/app/components/ui/card";

export const dynamic = "force-dynamic";

const Page = async () => {
  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");

  return (
    <Card>
      <CardContent>
        <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
          Notificaciones
        </h2>
        <div className="mt-4 max-w-xl">
          <NotificationTogglesForm
            saveUrl="/api/admin/staff/me/notificaciones"
            items={[
              {
                key: "notifyEmail",
                label: "Correo",
                description: "Alertas del sistema y avisos operativos por email.",
                checked: staff.notifyEmail,
              },
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default Page;
