import { NextRequest, NextResponse } from "next/server";
import { resolveAdminStaff } from "@/lib/auth/api-staff";
import { csvHeaders, toCsv, type CsvColumn } from "@/lib/crm/csv";
import { minorToMajor } from "@/lib/crm/money";
import {
  listAllPaymentsForExport,
  paymentListFiltersFromParams,
  type PaymentListRow,
} from "@/lib/crm/payments-list";

export const dynamic = "force-dynamic";

/**
 * Importes en unidades normales, no en minor units: quien abre la hoja suma
 * pesos y dólares, no centavos. Van sin formato de miles para que la hoja los
 * lea como números.
 */
const amount = (minor: number | null, currency: string) =>
  minor == null ? "" : minorToMajor(minor, currency);

const contactName = (p: PaymentListRow) => {
  if (p.unidentified) return "Sin identificar";
  const c = p.enrollment.contact;
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(" ");
};

const COLUMNS: readonly CsvColumn<PaymentListRow>[] = [
  { header: "Creado", value: (p) => p.createdAt },
  { header: "Pagado", value: (p) => p.paidAt },
  { header: "Estado", value: (p) => p.status },
  { header: "Pasarela", value: (p) => p.provider },
  { header: "Contacto", value: contactName },
  { header: "Correo", value: (p) => p.enrollment.contact.email ?? p.payerEmail },
  { header: "Producto", value: (p) => p.enrollment.product.title },
  { header: "Moneda", value: (p) => p.currency },
  { header: "Importe", value: (p) => amount(p.amountMinor, p.currency) },
  { header: "Comisión", value: (p) => amount(p.feeMinor, p.currency) },
  { header: "Neto", value: (p) => amount(p.netMinor, p.currency) },
  { header: "País", value: (p) => p.payerCountryIso },
  { header: "Referencia del proveedor", value: (p) => p.providerPaymentId },
  { header: "Motivo del fallo", value: (p) => p.failureMessage ?? p.failureCode },
  { header: "Id interno", value: (p) => p.id },
];

/**
 * Exporta **todo lo que casa con el filtro**, no sólo las filas cargadas.
 *
 * La pantalla pagina de 50 en 50, y exportar sólo lo visible daría una hoja
 * que no cuadra con los totales de arriba, que sí se calculan sobre el conjunto
 * entero. Mismo filtro que la lista, leído con la misma función.
 */
export async function GET(req: NextRequest) {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const rows = await listAllPaymentsForExport(
    paymentListFiltersFromParams(req.nextUrl.searchParams),
  );
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(toCsv(rows, COLUMNS), {
    headers: csvHeaders(`pagos-${stamp}.csv`),
  });
}
