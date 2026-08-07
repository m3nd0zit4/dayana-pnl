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
 *
 * A propósito **no** usa `CrmPageShell`: durante la transición el esqueleto y
 * la página real conviven un instante en el DOM, y si ambos llevaran el
 * marcador `data-crm-page` habría dos. El contrato exige exactamente uno, y
 * tiene razón — el marcador identifica la página, no cualquier cosa que ocupe
 * su sitio.
 */
const PanelLoading = () => (
  <div className="crm-page-shell">
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="overflow-hidden rounded-xl border">
        <CrmLoadingState rows={5} />
      </div>
    </div>
  </div>
);

export default PanelLoading;
