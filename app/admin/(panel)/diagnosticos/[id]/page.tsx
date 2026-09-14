import { notFound } from "next/navigation";
import DiagnosticDetailClient from "@/app/components/admin/crm/DiagnosticDetailClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getDiagnosticById } from "@/lib/crm/diagnostics";
import {
  getOperationalTimezone,
  OPERATIONAL_TZ,
} from "@/lib/crm/operational-timezone";
import { PREVIEW_DIAGNOSTICS } from "@/lib/crm/preview-data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Ficha de un diagnóstico: qué contestó la persona, cuándo, y qué tan cerca
 * está de decidirse. El id no se lee en vista previa — `isCrmUiPreview()`
 * siempre enseña el primer registro de muestra, igual que hacen el resto de
 * detalles del panel (ver `e2e/routes.ts`).
 *
 * La zona horaria se resuelve aquí y viaja al cliente: las fechas se formatean
 * con ella en los dos lados y el HTML coincide al hidratar.
 */
const DiagnosticoDetailPage = async ({ params }: Props) => {
  const { id } = await params;

  if (isCrmUiPreview()) {
    return (
      <DiagnosticDetailClient
        diagnostic={PREVIEW_DIAGNOSTICS[0]}
        timeZone={OPERATIONAL_TZ}
      />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const [diagnostic, timeZone] = await Promise.all([
    getDiagnosticById(id),
    getOperationalTimezone().catch(() => OPERATIONAL_TZ),
  ]);
  if (!diagnostic) notFound();

  return <DiagnosticDetailClient diagnostic={diagnostic} timeZone={timeZone} />;
};

export default DiagnosticoDetailPage;
