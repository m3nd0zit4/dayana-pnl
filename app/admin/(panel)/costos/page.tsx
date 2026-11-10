import { redirect } from "next/navigation";

import CostsPageClient from "@/app/components/admin/crm/costs/CostsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import type { CostsMonth } from "@/lib/crm/costs/build";
import { previewCostsMonth } from "@/lib/crm/costs/preview";
import { getCostsMonth } from "@/lib/crm/costs/store";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ mes?: string | string[] }> };

/**
 * Costos: lo que cuesta tener la plataforma funcionando, mes a mes. Facturas
 * y suscripciones registradas a mano más lo que la plataforma mide sola
 * (comisiones de pago, uso de la IA). Ver `lib/crm/costs/`.
 */
const CostosPage = async ({ searchParams }: Props) => {
  const { mes } = await searchParams;

  // Vista previa (dev local sin base de datos): datos de mentira, ninguna consulta.
  if (isCrmUiPreview()) {
    return <CostsPageClient costs={previewCostsMonth(mes)} />;
  }

  const staff = await getStaffSession();
  // Sin sesión: el layout del grupo `(panel)` ya redirige a `/acceso`.
  if (!staff) return null;
  // Como Estadísticas: solo quien administra el equipo. El enlace del menú es
  // `ownerOnly`; si el resto del staff llega a la URL a mano, se le rebota.
  if (staff.role !== "OWNER") redirect("/admin");

  // La consulta va dentro del try y el JSX fuera: un try/catch no atrapa
  // errores de render, solo los de la carga.
  let costs: CostsMonth | null = null;
  try {
    costs = await getCostsMonth(mes);
  } catch (e) {
    console.error("[costos] no se pudieron cargar", e);
  }

  if (!costs) {
    return (
      <CostsPageClient
        costs={previewCostsMonth(undefined)}
        error="No se pudieron cargar los costos. Intenta de nuevo en unos minutos."
      />
    );
  }

  return <CostsPageClient costs={costs} />;
};

export default CostosPage;
