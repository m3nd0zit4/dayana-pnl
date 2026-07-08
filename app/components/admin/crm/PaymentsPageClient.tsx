"use client";

import Link from "next/link";
import { PaymentStatus } from "@prisma/client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
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
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pagos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
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

        <Card className="overflow-hidden py-0">
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
            ) : (
              <div className="divide-y divide-border">
                {rows.length === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Sin pagos registrados.
                  </div>
                )}
                {rows.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap justify-between gap-3 p-4 transition-colors hover:bg-muted/50"
                  >
                    <div>
                      <div className="text-sm font-semibold">
                        {(p.amountMinor / 100).toFixed(2)} {p.currency}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.provider} · {STATUS_LABEL[p.status]}
                        {p.payerCountryIso && (
                          <span className="ml-1.5 opacity-70">· {p.payerCountryIso}</span>
                        )}
                      </div>
                      <Link
                        href={preview ? "#" : `/admin/contacts/${p.enrollment.contact.id}`}
                        className="mt-1 block text-xs text-primary hover:underline"
                      >
                        {p.enrollment.contact.firstName}{" "}
                        {p.enrollment.contact.lastName ?? ""} — {p.enrollment.product.title}
                      </Link>
                      {!preview && (
                        <Link
                          href={`/admin/enrollments/${p.enrollment.id}`}
                          className="mt-1 block text-xs text-muted-foreground hover:underline"
                        >
                          Ver servicio →
                        </Link>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.paidAt
                        ? new Date(p.paidAt).toLocaleString("es-CO")
                        : new Date(p.createdAt).toLocaleString("es-CO")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CrmPageShell>
  );
};

export default PaymentsPageClient;
