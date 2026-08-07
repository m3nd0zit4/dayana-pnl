"use client";

import Link from "next/link";
import { PaymentStatus } from "@prisma/client";
import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";
import { formatMoneyMinor } from "@/lib/crm/money";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmFilterBar,
  CrmLoadingState,
} from "./ui";

const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  FAILED: "Fallido",
  REFUNDED: "Reembolsado",
};

type Payment = {
  id: string;
  provider: string;
  status: PaymentStatus;
  currency: string;
  amountMinor: number;
  payerCountryIso: string | null;
  paidAt: string | null;
  createdAt: string;
  enrollment: {
    id: string;
    contact: { id: string; firstName: string; lastName: string | null };
    product: { title: string };
  };
};

type Props = { preview: boolean };

const PREVIEW: Payment[] = [
  {
    id: "pp1",
    provider: "PAYPAL",
    status: PaymentStatus.APPROVED,
    currency: "USD",
    amountMinor: 16000,
    payerCountryIso: "US",
    paidAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    enrollment: {
      id: "e1",
      contact: { id: "c1", firstName: "María", lastName: "G." },
      product: { title: "Terapia 6 sesiones" },
    },
  },
];

const PaymentsPageClient = ({ preview }: Props) => {
  const [rows, setRows] = useState<Payment[]>([]);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (preview) {
      setRows(PREVIEW);
      setLoading(false);
      return;
    }
    const params = status !== "all" ? `?status=${status}` : "";
    fetch(`/api/admin/payments${params}`)
      .then((r) => r.json())
      .then((d) => setRows(d.payments ?? []))
      .finally(() => setLoading(false));
  }, [preview, status]);

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Pagos"
        description="PayPal, Mercado Pago y registros manuales vinculados a cada servicio."
      />

      <CrmFilterBar count={`${rows.length} ${rows.length === 1 ? "pago" : "pagos"}`}>
        <div className="w-full sm:w-48">
          <SearchableSelect
            id="pay-status"
            label="Estado"
            value={status}
            options={[
              { value: "all", label: "Todos" },
              ...Object.entries(STATUS_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            onChange={setStatus}
            searchMinOptions={99}
          />
        </div>
      </CrmFilterBar>

      <CrmDataList>
        {loading ? (
          <CrmLoadingState rows={4} />
        ) : rows.length === 0 ? (
          <CrmEmptyState
            icon={Receipt}
            title="Sin pagos registrados"
            description="Aquí aparecen los cobros de PayPal y Mercado Pago, y los que registres a mano."
          />
        ) : (
          rows.map((p) => (
            <CrmDataListRow
              key={p.id}
              className="items-start transition-colors hover:bg-muted/50"
              actions={
                <span className="text-xs text-muted-foreground">
                  {p.paidAt
                    ? new Date(p.paidAt).toLocaleString("es-CO")
                    : new Date(p.createdAt).toLocaleString("es-CO")}
                </span>
              }
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {formatMoneyMinor(p.amountMinor, p.currency)} {p.currency}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {p.provider} · {STATUS_LABEL[p.status]}
                  {p.payerCountryIso ? (
                    <span className="ml-1.5 opacity-70">· {p.payerCountryIso}</span>
                  ) : null}
                </div>
                <Link
                  href={preview ? "#" : `/admin/contacts/${p.enrollment.contact.id}`}
                  className="mt-1 block text-xs text-primary hover:underline"
                >
                  {p.enrollment.contact.firstName}{" "}
                  {p.enrollment.contact.lastName ?? ""} — {p.enrollment.product.title}
                </Link>
                {!preview ? (
                  <Link
                    href={`/admin/enrollments/${p.enrollment.id}`}
                    className="mt-1 block text-xs text-muted-foreground hover:underline"
                  >
                    Ver servicio →
                  </Link>
                ) : null}
              </div>
            </CrmDataListRow>
          ))
        )}
      </CrmDataList>
    </CrmPageShell>
  );
};

export default PaymentsPageClient;
