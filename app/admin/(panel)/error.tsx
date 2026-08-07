"use client";

import { useEffect } from "react";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmErrorState from "@/app/components/admin/crm/ui/CrmErrorState";

/**
 * Frontera de error del panel.
 *
 * Sin esto, un fallo al renderizar en servidor sube hasta la pantalla de error
 * de Next, que saca al usuario del CRM entero — sidebar incluido — y no ofrece
 * más salida que recargar a mano.
 *
 * El mensaje real de la excepción no se enseña: puede llevar dentro cadenas de
 * conexión o correos. Va a la consola, que es donde sirve.
 */
const PanelError = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  useEffect(() => {
    console.error("[crm] error de renderizado", error);
  }, [error]);

  return (
    <CrmPageShell width="narrow">
      <CrmPageHeader title="Algo se rompió" />
      <CrmErrorState
        title="No se pudo cargar esta sección"
        message={
          error.digest
            ? `Vuelve a intentarlo. Si sigue pasando, pasa este código a soporte: ${error.digest}`
            : "Vuelve a intentarlo. Si sigue pasando, recarga la página."
        }
        onRetry={reset}
      />
    </CrmPageShell>
  );
};

export default PanelError;
