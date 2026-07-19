import { requirePortalContext } from "@/lib/lms/portal";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import ProfileForm from "@/app/components/miembros/ProfileForm";
import AvatarUploadField from "@/app/components/shared/settings/AvatarUploadField";
import { Card, CardContent } from "@/app/components/ui/card";

const Page = async () => {
  const { contact } = await requirePortalContext();

  const parsedPhone =
    contact.phoneE164.startsWith("+") && !contact.phoneE164.includes(":")
      ? parsePhoneNumberFromString(contact.phoneE164)
      : null;

  return (
    <Card>
      <CardContent className="space-y-6">
        <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
          Mi perfil
        </h2>
        <AvatarUploadField
          uploadUrl="/api/miembros/perfil/avatar"
          name={contact.displayName ?? contact.firstName}
          initialAvatarUrl={contact.avatarUrl}
        />
        <div className="max-w-xl">
          <ProfileForm
            initialFirstName={contact.firstName}
            initialLastName={contact.lastName ?? ""}
            initialPhone={parsedPhone?.isValid() ? parsedPhone.number : ""}
            initialWorkDescription={contact.workDescription ?? ""}
            initialPreferredLocale={contact.preferredLocale}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default Page;
