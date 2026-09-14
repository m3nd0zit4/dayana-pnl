"use client";

import Link from "next/link";
import { PaymentProvider, PaymentStatus } from "@prisma/client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Download, FileText, Receipt, UserPlus } from "lucide-react";
import CrmPageHeader from "./CrmPageHeader";
import CrmNewButton from "./CrmNewButton";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";
import RegisterPaymentFlow from "./RegisterPaymentFlow";
import IdentifyPaymentModal from "./IdentifyPaymentModal";
import SearchableSelect from "./SearchableSelect";
import { useActiveProducts } from "./hooks/useReferenceData";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { formatMoneyMinor } from "@/lib/crm/money";
import { productSelectOptions } from "@/lib/crm/form-select-options";
import type { PaymentCurrencyTotal, PaymentListRow } from "@/lib/crm/payments-list";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmErrorState,
  CrmFilterBar,
  CrmFilterSheet,
  CrmLoadingState,
  CrmLoadMore,
  CrmRowActions,
  CrmSearchInput,
} from "./ui";

const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  FAILED: "Fallido",
  REFUNDED: "Reembolsado",
};

const STATUS_BADGE_CLASS: Record<PaymentStatus, string> = {
  APPROVED: "border-success/40 bg-success/10 text-success",
  PENDING: "border-warning/40 bg-warning/10 text-warning",
  FAILED: "border-destructive/40 bg-destructive/10 text-destructive",
  REFUNDED: "",
};

const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Manual",
};

type Payment = PaymentListRow;

type Filters = {
  q: string;
  from: string;
  to: string;
  status: string;
  provider: string;
  productId: string;
  unidentified: boolean;
};

const PAYMENT_STATUS_VALUES = ["PENDING", "APPROVED", "FAILED", "REFUNDED"] as const;
const PAYMENT_PROVIDER_VALUES = ["PAYPAL", "MERCADO_PAGO", "MANUAL"] as const;
const oneOf = (value: string | null, allowed: readonly string[]): string =>
  value && allowed.includes(value) ? value : "all";

const filtersFromParams = (params: URLSearchParams): Filters => ({
  q: params.get("q") ?? "",
  from: params.get("from") ?? "",
  to: params.get("to") ?? "",
  // Un valor inventado en la URL —un enlace viejo, una errata— no puede dejar
  // la lista en «No se pudo cargar» ni mandar el export a un 400 crudo: se
  // ignora y se muestran todos.
  status: oneOf(params.get("status"), PAYMENT_STATUS_VALUES),
  provider: oneOf(params.get("provider"), PAYMENT_PROVIDER_VALUES),
  productId: params.get("productId") ?? "all",
  // El aviso del panel enlaza aquí con `?sin-identificar=1`, así que la lista
  // abre ya filtrada en vez de dejar a Dayana buscándolos a ojo.
  unidentified: params.get("sin-identificar") === "1" || params.get("unidentified") === "1",
});

const buildQuery = (filters: Filters, extra?: Record<string, string>): URLSearchParams => {
  const p = new URLSearchParams();
  if (filters.q.trim()) p.set("q", filters.q.trim());
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  if (filters.status !== "all") p.set("status", filters.status);
  if (filters.provider !== "all") p.set("provider", filters.provider);
  if (filters.productId !== "all") p.set("productId", filters.productId);
  if (filters.unidentified) p.set("unidentified", "1");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
  }
  return p;
};

type Props = { preview: boolean };

const now = new Date().toISOString();

const PREVIEW: Payment[] = [
  {
    id: "pp1",
    provider: "PAYPAL",
    status: "APPROVED",
    currency: "USD",
    amountMinor: 16000,
    feeMinor: 704,
    netMinor: 15296,
    payerEmail: "maria.g@example.com",
    payerCountryIso: "US",
    failureCode: null,
    failureMessage: null,
    providerPaymentId: "8HT03621JC123456",
    providerOrderId: "9WT03621JC654321",
    paidAt: now,
    createdAt: now,
    unidentified: false,
    enrollment: {
      id: "e1",
      contact: {
        id: "c1",
        firstName: "María",
        lastName: "G.",
        displayName: null,
        email: "maria.g@example.com",
      },
      product: { id: "prod-therapy-6", title: "Terapia 6 sesiones" },
    },
  },
  {
    id: "pp2",
    provider: "MERCADO_PAGO",
    status: "APPROVED",
    currency: "COP",
    amountMinor: 450000,
    feeMinor: 19800,
    netMinor: 430200,
    payerEmail: "laura.perez@example.com",
    payerCountryIso: "CO",
    failureCode: null,
    failureMessage: null,
    providerPaymentId: "112233445566",
    providerOrderId: null,
    paidAt: now,
    createdAt: now,
    unidentified: false,
    enrollment: {
      id: "e2",
      contact: {
        id: "c2",
        firstName: "Laura",
        lastName: "Pérez",
        displayName: null,
        email: "laura.perez@example.com",
      },
      product: { id: "prod-workshop", title: "Taller en vivo" },
    },
  },
  {
    id: "pp3",
    provider: "MERCADO_PAGO",
    status: "FAILED",
    currency: "COP",
    amountMinor: 320000,
    feeMinor: null,
    netMinor: null,
    payerEmail: "andres.ruiz@example.com",
    payerCountryIso: "CO",
    failureCode: "cc_rejected_insufficient_amount",
    failureMessage: "Fondos insuficientes en la tarjeta del comprador.",
    providerPaymentId: "998877665544",
    providerOrderId: null,
    paidAt: null,
    createdAt: now,
    unidentified: false,
    enrollment: {
      id: "e3",
      contact: {
        id: "c3",
        firstName: "Andrés",
        lastName: "Ruiz",
        displayName: null,
        email: "andres.ruiz@example.com",
      },
      product: { id: "prod-therapy-6", title: "Terapia 6 sesiones" },
    },
  },
  {
    id: "pp4",
    provider: "PAYPAL",
    status: "PENDING",
    currency: "USD",
    amountMinor: 9900,
    feeMinor: null,
    netMinor: null,
    payerEmail: null,
    payerCountryIso: "MX",
    failureCode: null,
    failureMessage: null,
    providerPaymentId: "PEND03621JC000001",
    providerOrderId: null,
    paidAt: null,
    createdAt: now,
    unidentified: true,
    enrollment: {
      id: "e4",
      contact: {
        id: "c4",
        firstName: "Pendiente",
        lastName: null,
        displayName: null,
        email: null,
      },
      product: { id: "prod-workshop", title: "Taller en vivo" },
    },
  },
];

const PREVIEW_TOTALS: PaymentCurrencyTotal[] = [
  { currency: "COP", approvedMinor: 450000, approvedCount: 1, pendingCount: 0, failedCount: 1, refundedCount: 0 },
  { currency: "USD", approvedMinor: 16000, approvedCount: 1, pendingCount: 1, failedCount: 0, refundedCount: 0 },
];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

const PaymentsPageClient = ({ preview }: Props) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canRecordPayments } = useCrm();
  const [registering, setRegistering] = useState(false);

  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(searchParams));
  // El texto se escribe aquí de inmediato; `filters.q` (lo que de verdad se
  // consulta y sincroniza a la URL) se actualiza con un pequeño retardo, para
  // no lanzar una consulta por cada tecla.
  const [qInput, setQInput] = useState(filters.q);

  const [rows, setRows] = useState<Payment[]>([]);
  const [totals, setTotals] = useState<PaymentCurrencyTotal[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState<Payment | null>(null);
  // `filtersKey` no cambia cuando se reintenta con los mismos filtros — este
  // contador es lo que fuerza al efecto a volver a pedir la página.
  const [retryTick, setRetryTick] = useState(0);

  const { products, productsLoading } = useActiveProducts(!preview);

  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput }));
    }, 350);
    return () => clearTimeout(id);
  }, [qInput]);

  // Sincroniza la URL con los filtros — así una recarga (o compartir el
  // enlace) reproduce exactamente lo que se estaba viendo.
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    if (preview) return;
    const query = buildQuery(filters).toString();
    router.replace(`/admin/payments${query ? `?${query}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, preview]);

  const fetchSeq = useRef(0);

  useEffect(() => {
    if (preview) {
      setRows(PREVIEW);
      setTotals(PREVIEW_TOTALS);
      setCursor(null);
      setLoading(false);
      return;
    }
    const seq = ++fetchSeq.current;
    setLoading(true);
    setError(null);
    const query = buildQuery(filters).toString();
    fetch(`/api/admin/payments${query ? `?${query}` : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error("load_failed");
        return r.json();
      })
      .then((d: { payments: Payment[]; nextCursor: string | null; totals: PaymentCurrencyTotal[] }) => {
        if (seq !== fetchSeq.current) return;
        setRows(d.payments ?? []);
        setTotals(d.totals ?? []);
        setCursor(d.nextCursor ?? null);
      })
      .catch(() => {
        if (seq !== fetchSeq.current) return;
        setError("No se pudieron cargar los pagos.");
      })
      .finally(() => {
        if (seq === fetchSeq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, preview, retryTick]);

  const loadMore = async () => {
    if (!cursor || preview) return;
    setLoadingMore(true);
    try {
      const query = buildQuery(filters, { cursor }).toString();
      const res = await fetch(`/api/admin/payments?${query}`);
      if (!res.ok) throw new Error("load_failed");
      const data = (await res.json()) as {
        payments: Payment[];
        nextCursor: string | null;
      };
      setRows((prev) => [...prev, ...(data.payments ?? [])]);
      setCursor(data.nextCursor ?? null);
    } catch {
      setError("No se pudieron cargar más pagos.");
    } finally {
      setLoadingMore(false);
    }
  };

  const retry = () => setRetryTick((t) => t + 1);

  const productOptions = useMemo(
    () => [
      { value: "all", label: "Todos los productos" },
      ...productSelectOptions(products),
    ],
    [products]
  );

  /**
   * Cuántos pagos casan con los filtros, no cuántos hay cargados. Los totales
   * se calculan sobre todo el conjunto, así que sumar sus contadores da la
   * cifra real; `rows.length` diría «50 pagos» habiendo trescientos, que es
   * justo el número que alguien apuntaría creyendo que es el del período.
   */
  const matchCount = totals.reduce(
    (n, t) =>
      n + t.approvedCount + t.pendingCount + t.failedCount + t.refundedCount,
    0
  );

  // Filtros de la hoja con un valor distinto del de por defecto. La búsqueda y
  // «Sin identificar» se ven en la barra y no cuentan.
  const activeCount =
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.provider !== "all" ? 1 : 0) +
    (filters.productId !== "all" ? 1 : 0);

  const clearSheetFilters = () =>
    setFilters((f) => ({ ...f, from: "", to: "", status: "all", provider: "all", productId: "all" }));

  const exportUrl = useMemo(() => {
    const query = buildQuery(filters).toString();
    return `/api/admin/payments/export${query ? `?${query}` : ""}`;
  }, [filters]);

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Pagos"
        description="PayPal, Mercado Pago y registros manuales vinculados a cada servicio."
        action={
          canRecordPayments ? (
            <CrmNewButton
              label="Registrar pago"
              icon={CreditCard}
              onClick={() => setRegistering(true)}
            />
          ) : undefined
        }
      />

      {/* Totales del período — SIEMPRE por moneda, nunca sumados entre ellas:
          sumar pesos y dólares da un número que no significa nada. */}
      {totals.length > 0 ? (
        <div className="flex flex-wrap gap-6 rounded-lg border border-border bg-card px-4 py-3">
          {totals.map((t) => (
            <div key={t.currency}>
              <p className="text-xs text-muted-foreground">Aprobado en {t.currency}</p>
              <p className="mt-0.5 text-lg font-semibold text-success">
                {formatMoneyMinor(t.approvedMinor, t.currency)} {t.currency}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  · {t.approvedCount} {t.approvedCount === 1 ? "pago" : "pagos"}
                </span>
              </p>
              {t.pendingCount > 0 || t.failedCount > 0 || t.refundedCount > 0 ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.pendingCount > 0 ? `${t.pendingCount} pendiente(s)` : null}
                  {t.pendingCount > 0 && (t.failedCount > 0 || t.refundedCount > 0) ? " · " : null}
                  {t.failedCount > 0 ? (
                    <span className="text-destructive">{t.failedCount} rechazado(s)</span>
                  ) : null}
                  {t.failedCount > 0 && t.refundedCount > 0 ? " · " : null}
                  {t.refundedCount > 0 ? `${t.refundedCount} reembolsado(s)` : null}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <CrmFilterBar count={`${matchCount} ${matchCount === 1 ? "pago" : "pagos"}`}>
        <CrmSearchInput
          value={qInput}
          onChange={setQInput}
          placeholder="Nombre, email o ID de pago…"
        />

        {/* Visible porque es a donde manda «Para hoy»: un pago que entró y no
            se sabe de quién. */}
        <Button
          type="button"
          variant={filters.unidentified ? "default" : "outline"}
          onClick={() =>
            setFilters((f) => ({ ...f, unidentified: !f.unidentified }))
          }
        >
          <UserPlus aria-hidden />
          {/* Sin contador: sólo se sabría el de la página cargada, y un «(3)»
              con doce más esperando en la siguiente engaña más que ayuda. */}
          Sin identificar
        </Button>

        <CrmFilterSheet
          activeCount={activeCount}
          onClear={clearSheetFilters}
          footer={
            !preview ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={<a href={exportUrl} />}
              >
                <Download aria-hidden />
                Exportar estos pagos (CSV)
              </Button>
            ) : undefined
          }
        >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="pay-from" className="mb-1 block text-xs text-muted-foreground">
              Desde
            </Label>
            <Input
              id="pay-from"
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="pay-to" className="mb-1 block text-xs text-muted-foreground">
              Hasta
            </Label>
            <Input
              id="pay-to"
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
        </div>

        <div className="w-full">
          <SearchableSelect
            id="pay-status"
            label="Estado"
            value={filters.status}
            options={[
              { value: "all", label: "Todos los estados" },
              ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            searchMinOptions={99}
          />
        </div>

        <div className="w-full">
          <SearchableSelect
            id="pay-provider"
            label="Proveedor"
            value={filters.provider}
            options={[
              { value: "all", label: "Todos los proveedores" },
              ...Object.entries(PROVIDER_LABEL).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, provider: v }))}
            searchMinOptions={99}
          />
        </div>

        <div className="w-full">
          <SearchableSelect
            id="pay-product"
            label="Producto"
            value={filters.productId}
            options={productOptions}
            onChange={(v) => setFilters((f) => ({ ...f, productId: v }))}
            disabled={productsLoading}
          />
        </div>
        </CrmFilterSheet>
      </CrmFilterBar>

      {error ? (
        <CrmErrorState message={error} onRetry={retry} />
      ) : (
        <CrmDataList>
          {loading ? (
            <CrmLoadingState rows={5} />
          ) : rows.length === 0 ? (
            <CrmEmptyState
              icon={Receipt}
              title="Sin pagos que coincidan"
              description="Ajusta la búsqueda o los filtros — aquí aparecen los cobros de PayPal y Mercado Pago, y los que registres a mano."
            />
          ) : (
            rows.map((p) => (
              <CrmDataListRow
                key={p.id}
                className="items-start transition-colors hover:bg-muted/50"
                actions={
                  // Sólo lo aprobado lleva recibo: un comprobante dice «esto se
                  // cobró», y emitirlo para un intento rechazado afirmaría algo
                  // que no pasó. Abre en pestaña porque la ruta lo sirve
                  // `inline` — se ve antes de guardarlo.
                  !preview && p.status === "APPROVED" ? (
                    <CrmRowActions>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Recibo PDF"
                        title="Recibo PDF"
                        nativeButton={false}
                        render={
                          <a
                            href={`/api/admin/payments/${p.id}/receipt`}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        }
                      >
                        <FileText aria-hidden />
                      </Button>
                    </CrmRowActions>
                  ) : undefined
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">
                      {formatMoneyMinor(p.amountMinor, p.currency)} {p.currency}
                    </span>
                    <Badge
                      variant={p.status === "REFUNDED" ? "secondary" : "default"}
                      className={STATUS_BADGE_CLASS[p.status] || undefined}
                    >
                      {STATUS_LABEL[p.status]}
                    </Badge>
                    {p.unidentified ? (
                      <Badge variant="secondary">Sin identificar</Badge>
                    ) : null}
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>
                      {formatDate(p.paidAt ?? p.createdAt)} · {PROVIDER_LABEL[p.provider]}
                      {p.payerCountryIso ? ` · ${p.payerCountryIso}` : ""}
                    </span>
                  </div>

                  {/* El motivo del rechazo es lo que este rediseño existe para
                      mostrar: `failureMessage` ya está traducido para el
                      equipo y hasta ahora no se leía en ninguna pantalla. El
                      código crudo del proveedor queda disponible pero
                      secundario — es lo que sirve para reclamar meses
                      después, no lo primero que hay que leer. */}
                  {p.status === "FAILED" && p.failureMessage ? (
                    <p className="mt-1 text-xs text-destructive">
                      {p.failureMessage}
                      {p.failureCode ? (
                        <span className="ml-1 text-muted-foreground">
                          ({p.failureCode})
                        </span>
                      ) : null}
                    </p>
                  ) : null}

                  {p.unidentified ? (
                    /*
                      Sin ficha real no hay a dónde enlazar: el nombre que se
                      mostraría es el del temporal («Pendiente», «—») y llevaba
                      a una ficha que se borra sola esa noche. Se ofrece la
                      acción que sí sirve: ponerle dueño.
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
                      href={preview ? "#" : `/admin/contacts/${p.enrollment.contact.id}`}
                      className="mt-1 block text-xs text-primary hover:underline"
                    >
                      {p.enrollment.contact.displayName ??
                        `${p.enrollment.contact.firstName} ${p.enrollment.contact.lastName ?? ""}`}{" "}
                      — {p.enrollment.product.title}
                    </Link>
                  )}
                </div>
              </CrmDataListRow>
            ))
          )}
        </CrmDataList>
      )}

      <CrmLoadMore hasMore={!preview && cursor !== null} loading={loadingMore} onClick={loadMore} />

      {canRecordPayments ? (
        <RegisterPaymentFlow
          open={registering}
          onClose={() => setRegistering(false)}
          onSuccess={retry}
        />
      ) : null}

      {identifying ? (
        <IdentifyPaymentModal
          open
          onClose={() => setIdentifying(null)}
          paymentId={identifying.id}
          summary={`${formatMoneyMinor(identifying.amountMinor, identifying.currency)} ${identifying.currency} · ${PROVIDER_LABEL[identifying.provider]} · ${identifying.enrollment.product.title}`}
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
                          displayName: null,
                          email: null,
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
