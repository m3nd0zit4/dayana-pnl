import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import CrmLoadingState from "@/app/components/admin/crm/ui/CrmLoadingState";
import { Skeleton } from "@/app/components/ui/skeleton";

/**
 * Estado de carga por defecto de todo el panel.
 *
 * No existía ningún `loading.tsx` ni `error.tsx` en toda la aplicación, así que
 * navegar entre secciones dejaba la pantalla anterior congelada hasta que el
 * servidor respondía. Esto le da al App Router algo que enseñar mientras tanto.
 *
 * Reproduce la forma de una página migrada — cabecera y lista — para que la
 * transición al contenido real no dé un salto de layout.
 */
const PanelLoading = () => (
  <CrmPageShell>
    <div className="space-y-4">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72" />
    </div>
    <div className="overflow-hidden rounded-xl border">
      <CrmLoadingState rows={5} />
    </div>
  </CrmPageShell>
);

export default PanelLoading;
