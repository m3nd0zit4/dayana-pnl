import { PaymentProvider, PaymentStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireWriteStaff } from "@/lib/auth/api-staff";
import { csvMoney, csvRow } from "@/lib/crm/csv";
import { getDateKeyInTz, getTimeHmInTz } from "@/lib/crm/operational-timezone";
import {
  PAYMENTS_EXPORT_LIMIT,
  listPaymentsForExport,
} from "@/lib/crm/payments-list";

export const dynamic = "force-dynamic";

const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Manual",
};

const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  FAILED: "Fallido",
  REFUNDED: "Reembolsado",
};

const HEADER = [
  "Fecha",
  "Contacto",
  "Email del contacto",
  "Producto",
  "Proveedor",
  "Estado",
  "Moneda",
  "Monto",
  "Comisión",
  "Neto",
  "ID de pago del proveedor",
  "Código de error",
  "Motivo del rechazo",
];

const asStatus = (raw: string | null): PaymentStatus | "all" | undefined => {
  if (!raw || raw === "all") return "all";
  return (Object.values(PaymentStatus) as string[]).includes(raw)
    ? (raw as PaymentStatus)
    : undefined;
};

const asProvider = (raw: string | null): PaymentProvider | "all" | undefined => {
  if (!raw || raw === "all") return "all";
  return (Object.values(PaymentProvider) as string[]).includes(raw)
    ? (raw as PaymentProvider)
    : undefined;
};

/**
 * CSV de los pagos que casan con los filtros ACTUALES — no de la página que
 * el operador tiene cargada. Comparte `buildPaymentsWhere` con la lista vía
 * `listPaymentsForExport`, así que nunca puede exportar algo distinto de lo
 * que se está viendo en pantalla.
 */
export async function GET(req: NextRequest) {
  // Un export entero con los correos de los contactos no es una lectura: es
  // sacar datos personales en bloque. READONLY puede ver la lista en pantalla,
  // pero no descargarla.
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const params = req.nextUrl.searchParams;
  const status = asStatus(params.get("status"));
  const provider = asProvider(params.get("provider"));
  if (status === undefined || provider === undefined) {
    return NextResponse.json({ error: "invalid_filter" }, { status: 400 });
  }

  const { rows, truncated } = await listPaymentsForExport({
    q: params.get("q") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    status,
    provider,
    productId: params.get("productId") ?? undefined,
    unidentified: params.get("unidentified") === "1",
  });

  let csv = "﻿"; // BOM: Excel en Windows no detecta UTF-8 sin él.
  csv += csvRow(HEADER);
  for (const p of rows) {
    // `paidAt` si se cobró; si no, `createdAt` — el mismo fallback que el
    // filtro de fechas, para que la columna "Fecha" cuente lo mismo que el
    // rango que se usó para incluir la fila.
    const at = p.paidAt ?? p.createdAt;
    const date = `${getDateKeyInTz(new Date(at))} ${getTimeHmInTz(new Date(at))}`;
    const contactName =
      p.enrollment.contact.displayName ??
      `${p.enrollment.contact.firstName} ${p.enrollment.contact.lastName ?? ""}`.trim();

    csv += csvRow([
      date,
      contactName,
      p.enrollment.contact.email ?? "",
      p.enrollment.product.title,
      PROVIDER_LABEL[p.provider],
      STATUS_LABEL[p.status],
      p.currency,
      csvMoney(p.amountMinor, p.currency),
      csvMoney(p.feeMinor, p.currency),
      csvMoney(p.netMinor, p.currency),
      p.providerPaymentId,
      p.failureCode ?? "",
      p.failureMessage ?? "",
    ]);
  }
  if (truncated) {
    csv += csvRow([
      "AVISO",
      `Exportación truncada a ${PAYMENTS_EXPORT_LIMIT} filas — ajusta los filtros para acotar más.`,
    ]);
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pagos-${getDateKeyInTz(new Date())}.csv"`,
    },
  });
}
