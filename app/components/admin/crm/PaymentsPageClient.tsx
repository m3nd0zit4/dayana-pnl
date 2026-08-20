"use client";

import Link from "next/link";
import { PaymentStatus } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Receipt, UserPlus } from "lucide-react";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import IdentifyPaymentModal from "./IdentifyPaymentModal";
import SearchableSelect from "./SearchableSelect";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
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
  /** El pagador no traía email ni teléfono: la ficha es temporal. */
  unidentified?: boolean;
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
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Payment[]>([]);
  const [status, setStatus] = useState("all");
  // El aviso del panel enlaza aquí con `?sin-identificar=1`, así que la lista
  // abre ya filtrada en vez de dejar a Dayana buscándolos a ojo.
  const [onlyUnidentified, setOnlyUnidentified] = useState(
    searchParams.get("sin-identificar") === "1"
  );
  const [identifying, setIdentifying] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (preview) {
      setRows(PREVIEW);
      setLoading(false);
      return;
    }
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (onlyUnidentified) params.set("unidentified", "1");
    const query = params.toString();
    setLoading(true);
    fetch(`/api/admin/payments${query ? `?${query}` : ""}`)
      .then((r) => r.json())
      .then((d) => setRows(d.payments ?? []))
      .finally(() => setLoading(false));
  }, [preview, status, onlyUnidentified]);

  const unidentifiedCount = rows.filter((p) => p.unidentified).length;

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
        <Button
          type="button"
          variant={onlyUnidentified ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyUnidentified((v) => !v)}
        >
          <UserPlus aria-hidden />
          Sin identificar
          {onlyUnidentified || unidentifiedCount === 0
            ? ""
            : ` (${unidentifiedCount})`}
        </Button>
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
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>
                    {p.provider} · {STATUS_LABEL[p.status]}
                    {p.payerCountryIso ? (
                      <span className="ml-1.5 opacity-70">
                        · {p.payerCountryIso}
                      </span>
                    ) : null}
                  </span>
                  {p.unidentified ? (
                    <Badge variant="secondary">Sin identificar</Badge>
                  ) : null}
                </div>
                {p.unidentified ? (
                  /*
                    Sin ficha real no hay a dónde enlazar: el nombre que se
                    mostraría es el del temporal («Cliente», «—») y llevaba a
                    una ficha que se borra sola esa noche. Se ofrece la acción
                    que sí sirve: ponerle dueño.
                  */
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {p.enrollment.product.title}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => (preview ? undefined : setIdentifying(p))}
                    >
                      <UserPlus aria-hidden />
                      Asignar contacto
                    </Button>
                  </div>
                ) : (
                  <Link
                    href={
                      preview ? "#" : `/admin/contacts/${p.enrollment.contact.id}`
                    }
                    className="mt-1 block text-xs text-primary hover:underline"
                  >
                    {p.enrollment.contact.firstName}{" "}
                    {p.enrollment.contact.lastName ?? ""} —{" "}
                    {p.enrollment.product.title}
                  </Link>
                )}
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

      {identifying ? (
        <IdentifyPaymentModal
          open
          onClose={() => setIdentifying(null)}
          paymentId={identifying.id}
          summary={`${formatMoneyMinor(identifying.amountMinor, identifying.currency)} ${identifying.currency} · ${identifying.provider} · ${identifying.enrollment.product.title}`}
          onSuccess={(contact) =>
            setRows((prev) =>
              prev.map((row) =>
                row.id === identifying.id
                  ? {
                      ...row,
                      unidentified: false,
                      enrollment: {
                        ...row.enrollment,
                        contact: {
                          id: contact.id,
                          firstName: contact.firstName,
                          lastName: contact.lastName ?? null,
                        },
                      },
                    }
                  : row
              )
            )
          }
        />
      ) : null}
    </CrmPageShell>
  );
};

export default PaymentsPageClient;
