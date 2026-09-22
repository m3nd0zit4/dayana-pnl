import MagnetsPageClient, {
  type MagnetRow,
} from "@/app/components/admin/crm/MagnetsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listMagnetsForAdmin } from "@/lib/crm/magnets";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * «Comenta ÉXITO y te mando el material»: la pantalla donde viven esas
 * palabras, su material y el texto con el que se responde.
 */
const PalabrasClavePage = async () => {
  const siteUrl = getSiteUrl();
  if (isCrmUiPreview()) {
    return (
      <MagnetsPageClient preview initialMagnets={[]} siteUrl={siteUrl} />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const rows = await listMagnetsForAdmin();
  const magnets: MagnetRow[] = rows.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <MagnetsPageClient
      preview={false}
      initialMagnets={magnets}
      siteUrl={siteUrl}
    />
  );
};

export default PalabrasClavePage;
