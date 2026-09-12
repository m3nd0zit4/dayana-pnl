import AuditPageClient from "@/app/components/admin/crm/AuditPageClient";
import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

/**
 * Sólo OWNER, también en la página y no sólo en la API.
 *
 * `/api/admin/audit` ya devolvía 403 a cualquier otro rol, pero la página no
 * comprobaba nada: un OPERATOR podía abrirla y ver una lista que fallaba al
 * cargar. Ahora ni la ve — misma puerta que el resto de Ajustes, porque es ahí
 * donde se enlaza.
 */
const AuditPage = async () => {
  await requireOwnerSettings();
  return <AuditPageClient preview={isCrmUiPreview()} />;
};

export default AuditPage;
