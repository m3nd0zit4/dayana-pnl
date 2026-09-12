import { NextRequest, NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import {
  getPaymentTotals,
  listPayments,
  paymentListFiltersFromParams,
} from "@/lib/crm/payments-list";

export const dynamic = "force-dynamic";

/**
 * La lista de Pagos: búsqueda, filtros, paginación por cursor y totales.
 *
 * Antes devolvía las últimas 50 filas filtradas sólo por estado, y la pantalla
 * pintaba buscador, fechas y totales que el servidor ignoraba: se podía escribir
 * un nombre y la lista no cambiaba.
 *
 * Los totales sólo se calculan en la primera página. «Cargar más» pide la
 * siguiente con el mismo filtro, y el conjunto que suman no ha cambiado:
 * volver a agruparlo sería una consulta por pulsación para devolver el mismo
 * número.
 */
export async function GET(req: NextRequest) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const params = req.nextUrl.searchParams;
  const filters = paymentListFiltersFromParams(params);
  const cursor = params.get("cursor");
  const limit = Number(params.get("limit") ?? 50);

  const [page, totals] = await Promise.all([
    listPayments(filters, {
      cursor,
      limit: Number.isFinite(limit) ? limit : 50,
    }),
    cursor ? Promise.resolve(null) : getPaymentTotals(filters),
  ]);

  return NextResponse.json({ ...page, ...(totals ? { totals } : {}) });
}
