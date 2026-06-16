"use client";

import Link from "next/link";
import { PaymentStatus } from "@prisma/client";
import { useEffect, useState } from "react";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";

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
      <div className="space-y-6">
        <div>
          <h1 className="crm-section-title text-xl">Pagos</h1>
          <p className="crm-section-subtitle mt-1">
            PayPal, Mercado Pago y registros manuales vinculados a cada servicio.
          </p>
        </div>

        <div className="w-48">
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

        <div className="crm-surface-card overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-[var(--crm-muted)]">Cargando…</p>
          ) : (
            <ul className="divide-y divide-[var(--crm-border)]">
              {rows.length === 0 && (
                <li className="p-8 text-center text-sm text-[var(--crm-muted)]">
                  Sin pagos registrados.
                </li>
              )}
              {rows.map((p) => (
                <li key={p.id} className="crm-table-row flex flex-wrap justify-between gap-3 p-4">
                  <div>
                    <div className="text-sm font-semibold">
                      {(p.amountMinor / 100).toFixed(2)} {p.currency}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--crm-muted)]">
                      {p.provider} · {STATUS_LABEL[p.status]}
                    </div>
                    <Link
                      href={preview ? "#" : `/admin/contacts/${p.enrollment.contact.id}`}
                      className="mt-1 block text-xs text-[var(--crm-accent)] hover:underline"
                    >
                      {p.enrollment.contact.firstName}{" "}
                      {p.enrollment.contact.lastName ?? ""} — {p.enrollment.product.title}
                    </Link>
                    {!preview && (
                      <Link
                        href={`/admin/enrollments/${p.enrollment.id}`}
                        className="mt-1 block text-xs text-[var(--crm-muted)] hover:underline"
                      >
                        Ver servicio →
                      </Link>
                    )}
                  </div>
                  <div className="text-xs text-[var(--crm-muted)]">
                    {p.paidAt
                      ? new Date(p.paidAt).toLocaleString("es-CO")
                      : new Date(p.createdAt).toLocaleString("es-CO")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </CrmPageShell>
  );
};

export default PaymentsPageClient;
