import type { ReactNode } from "react";
import CrmPageShell from "./CrmPageShell";

/**
 * El marco de página, salvo cuando la pantalla vive dentro de otra.
 *
 * Membresías junta dos pantallas que antes eran rutas propias, cada una con su
 * `CrmPageShell` y su cabecera. Metidas tal cual en pestañas pintarían dos
 * marcos y dos títulos uno dentro del otro. Con `embedded` ceden el marco a la
 * pantalla que las contiene y conservan sólo su contenido.
 */
const CrmMaybeShell = ({
  embedded,
  children,
}: {
  embedded: boolean;
  children: ReactNode;
}) =>
  embedded ? (
    <div className="space-y-6">{children}</div>
  ) : (
    <CrmPageShell>{children}</CrmPageShell>
  );

export default CrmMaybeShell;
