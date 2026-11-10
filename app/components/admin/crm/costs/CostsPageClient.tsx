"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { COST_SERVICE_IDS, COST_SERVICES, type CostServiceId } from "@/lib/crm/costs/catalog";
import type { CostBillRow, CostServiceRow, CostsMonth } from "@/lib/crm/costs/build";
import {
  CADENCE_LABEL,
  COST_CADENCES,
  COST_CURRENCIES,
  addMonths,
  amountInputValue,
  billAppliesTo,
  formatBillAmount,
  formatUsdCents,
  monthLabel,
  monthOf,
  parseAmountInput,
  type CostCadence,
  type CostCurrency,
} from "@/lib/crm/costs/rules";
import { withDelta } from "@/lib/crm/stats/kpi";
import { cn } from "@/lib/utils";

import CrmModal from "../CrmModal";
import CrmNewButton from "../CrmNewButton";
import CrmPageHeader from "../CrmPageHeader";
import CrmPageShell from "../CrmPageShell";
import { useCrm } from "../CrmProvider";
import KpiCard from "../stats/KpiCard";
import SeriesChartCard from "../stats/SeriesChartCard";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmErrorState,
  CrmField,
  CrmFormActions,
  CrmRowActions,
  CrmRowDelete,
  CrmRowEdit,
} from "../ui";

type Props = {
  costs: CostsMonth;
  /** La carga falló: se pinta el aviso y nada más. */
  error?: string;
};

type FormState = {
  id: string | null;
  serviceId: CostServiceId;
  label: string;
  amount: string;
  currency: CostCurrency;
  cadence: CostCadence;
  startsOn: string;
  endsOn: string;
  note: string;
};

const ERRORS: Record<string, string> = {
  invalid_service: "Elige un servicio de la lista.",
  invalid_cadence: "Elige cada cuánto se paga.",
  invalid_currency: "Elige la moneda.",
  invalid_amount: "Escribe el monto, mayor que cero.",
  invalid_start: "Elige la fecha.",
  invalid_end: "La fecha de fin no puede ser anterior a la de inicio.",
  label_too_long: "El concepto es demasiado largo (máximo 80 letras).",
  note_too_long: "La nota es demasiado larga (máximo 300 letras).",
  not_found: "Esa factura ya no existe. Recarga la página.",
  forbidden: "Solo la dueña puede registrar facturas.",
};

const DAY_FMT = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** «3 jun 2026» a partir de `YYYY-MM-DD`. */
const dayLabel = (dateKey: string): string => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return DAY_FMT.format(new Date(Date.UTC(y, m - 1, d))).replace(/\./g, "");
};

/** Hoy en el reloj de quien mira, `YYYY-MM-DD`. */
const todayKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const COP_FMT = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

const sourceBadge = (row: CostServiceRow) => {
  if (row.source === "bill") return <Badge variant="secondary">Factura</Badge>;
  if (row.source === "both") return <Badge variant="secondary">Factura y medido</Badge>;
  if (row.source === "measured") {
    return <Badge variant="outline">{row.measured?.kind === "estimate" ? "Aproximado" : "Medido"}</Badge>;
  }
  return null;
};

/** La línea pequeña bajo el servicio: cuánto se usó y, si la factura manda, lo medido como referencia. */
const serviceDetail = (row: CostServiceRow): string | null => {
  const parts: string[] = [];
  if (row.activity) parts.push(row.activity);
  if (row.measured?.copMinor) parts.push(`$${COP_FMT.format(row.measured.copMinor)} COP`);
  if (row.source === "bill" && row.measured) {
    parts.push(`medido: ${formatUsdCents(row.measured.usdCents)}${row.measured.kind === "estimate" ? " aprox." : ""}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
};

const billWhen = (bill: CostBillRow): string => {
  if (bill.upcoming) return `${CADENCE_LABEL[bill.cadence]} · empieza el ${dayLabel(bill.startsOn)}`;
  if (bill.cadence === "ONE_TIME") return `Una sola vez · ${dayLabel(bill.startsOn)}`;
  const since = `${CADENCE_LABEL[bill.cadence]} · desde ${dayLabel(bill.startsOn)}`;
  return bill.endsOn ? `${since} hasta ${dayLabel(bill.endsOn)}` : since;
};

/**
 * Costos de la plataforma: el total del mes, de dónde sale cada cifra y las
 * facturas registradas. Los datos llegan ya calculados del servidor
 * (`getCostsMonth`); tras guardar o borrar se vuelve a pedir la página.
 */
const CostsPageClient = ({ costs, error }: Props) => {
  const router = useRouter();
  const { canManageTeam, toast, confirm } = useCrm();
  const [navigating, startNavigation] = useTransition();
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { month, currentMonth } = costs;
  const isCurrentMonth = month === currentMonth;

  const goToMonth = (target: string) =>
    startNavigation(() => router.push(target === currentMonth ? "/admin/costos" : `/admin/costos?mes=${target}`));

  const openNew = () => {
    setFormError(null);
    setForm({
      id: null,
      serviceId: "vercel",
      label: "",
      amount: "",
      currency: "USD",
      cadence: "MONTHLY",
      // En un mes pasado lo normal es registrar algo de ese mes.
      startsOn: isCurrentMonth ? todayKey() : `${month}-01`,
      endsOn: "",
      note: "",
    });
  };

  const openEdit = (bill: CostBillRow) => {
    setFormError(null);
    setForm({
      id: bill.id,
      serviceId: bill.serviceId,
      label: bill.label,
      amount: amountInputValue(bill.amountMinor, bill.currency),
      currency: bill.currency,
      cadence: bill.cadence,
      startsOn: bill.startsOn,
      endsOn: bill.endsOn ?? "",
      note: bill.note ?? "",
    });
  };

  const save = async () => {
    if (!form) return;
    const amountMinor = parseAmountInput(form.amount, form.currency);
    if (amountMinor == null) {
      setFormError(ERRORS.invalid_amount);
      return;
    }
    if (!form.startsOn) {
      setFormError(ERRORS.invalid_start);
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      const payload = {
        serviceId: form.serviceId,
        label: form.label,
        cadence: form.cadence,
        currency: form.currency,
        amountMinor,
        startsOn: form.startsOn,
        endsOn: form.cadence === "ONE_TIME" ? null : form.endsOn || null,
        note: form.note,
      };
      const res = await fetch(form.id ? `/api/admin/costs/${form.id}` : "/api/admin/costs", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFormError(ERRORS[data.error ?? ""] ?? "No se pudo guardar. Intenta de nuevo.");
        return;
      }

      setForm(null);
      // Si lo guardado no cuenta en el mes que se está mirando, se lleva a quien
      // lo registró al mes donde sí: si no, parecería que no se guardó.
      const startMonth = monthOf(payload.startsOn);
      if (billAppliesTo(payload, month)) {
        toast(form.id ? "Factura actualizada" : "Factura registrada", "success");
        startNavigation(() => router.refresh());
      } else if (startMonth > currentMonth) {
        // Las que aún no empiezan se listan en el mes actual.
        toast(`Guardada. Empieza a contar en ${monthLabel(startMonth)}.`, "success");
        if (isCurrentMonth) startNavigation(() => router.refresh());
        else goToMonth(currentMonth);
      } else {
        toast(`Guardada en ${monthLabel(startMonth)}.`, "success");
        goToMonth(startMonth);
      }
    } catch {
      setFormError("No se pudo guardar. Revisa la conexión e intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const remove = (bill: CostBillRow) =>
    confirm({
      title: "Eliminar factura",
      message: `«${bill.label}» dejará de contar en todos los meses. Si solo la cancelaste, edítala y ponle fecha de fin.`,
      confirmLabel: "Eliminar",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/costs/${bill.id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) {
          toast("No se pudo eliminar", "error");
          return;
        }
        toast("Factura eliminada", "success");
        startNavigation(() => router.refresh());
      },
    });

  const monthNav = (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Mes anterior"
        title="Mes anterior"
        disabled={navigating}
        onClick={() => goToMonth(addMonths(month, -1))}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <p className="min-w-40 text-center text-sm font-medium first-letter:uppercase" aria-live="polite">
        {monthLabel(month)}
      </p>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Mes siguiente"
        title="Mes siguiente"
        disabled={navigating || isCurrentMonth}
        onClick={() => goToMonth(addMonths(month, 1))}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );

  const header = (
    <CrmPageHeader
      title="Costos"
      description="Lo que cuesta tener la plataforma funcionando cada mes: las facturas que registras y lo que se mide solo."
      action={canManageTeam && !error ? <CrmNewButton label="Registrar factura" onClick={openNew} /> : undefined}
      trailing={error ? undefined : monthNav}
    />
  );

  if (error) {
    return (
      <CrmPageShell>
        {header}
        <CrmErrorState message={error} onRetry={() => router.refresh()} />
      </CrmPageShell>
    );
  }

  const selected = form ? COST_SERVICES[form.serviceId] : null;
  const countedBills = costs.bills.filter((bill) => !bill.upcoming).length;

  return (
    <CrmPageShell>
      {header}

      <div className={cn("space-y-6 transition-opacity", navigating && "opacity-60")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard
            label={isCurrentMonth ? "Total del mes, hasta hoy" : "Total del mes"}
            value={formatUsdCents(costs.totalUsdCents)}
            note={`≈ $${COP_FMT.format((costs.totalUsdCents / 100) * costs.usdToCop)} COP`}
            kpi={withDelta(Math.round(costs.totalUsdCents), Math.round(costs.previousUsdCents))}
            positiveWhen="down"
            caption="vs mes anterior"
          />
          <KpiCard
            label="Facturas y suscripciones"
            value={formatUsdCents(costs.billsUsdCents)}
            note={
              countedBills === 1 ? "1 registrada que cuenta este mes" : `${countedBills} registradas que cuentan este mes`
            }
          />
          <KpiCard
            label="Medido por la plataforma"
            value={formatUsdCents(costs.measuredUsdCents)}
            note="Comisiones de pago y uso de la IA en WhatsApp"
          />
        </div>

        <SeriesChartCard
          title="Últimos 6 meses"
          description="Total de cada mes, en dólares."
          points={costs.trend.map((p) => ({ key: p.month, value: Math.round(p.usdCents) / 100 }))}
          granularity="month"
          seriesLabel="Costo"
          valueFormatter={(v) => formatUsdCents(v * 100)}
        />

        <section className="space-y-3" aria-labelledby="costos-servicios">
          <h2 id="costos-servicios" className="text-sm font-semibold tracking-tight">
            Por servicio
          </h2>
          <CrmDataList>
            {costs.services.map((row) => {
              const detail = serviceDetail(row);
              return (
                <CrmDataListRow key={row.id}>
                  <div className="min-w-0 flex-1 basis-64 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {row.name}
                      {sourceBadge(row)}
                    </p>
                    <p className="text-sm text-muted-foreground">{row.what}</p>
                    {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
                  </div>
                  <p
                    className={cn(
                      "text-sm tabular-nums sm:w-32 sm:text-right",
                      row.source === "none" ? "text-muted-foreground" : "font-medium",
                    )}
                  >
                    {row.source === "none" ? "Sin registrar" : formatUsdCents(row.usdCents)}
                  </p>
                </CrmDataListRow>
              );
            })}
          </CrmDataList>
        </section>

        <section className="space-y-3" aria-labelledby="costos-facturas">
          <h2 id="costos-facturas" className="text-sm font-semibold tracking-tight">
            Facturas y suscripciones
          </h2>
          <CrmDataList>
            {costs.bills.length === 0 ? (
              <CrmEmptyState
                icon={Receipt}
                title={costs.hasBills ? "Ninguna factura cuenta en este mes" : "Aún no hay facturas registradas"}
                description={
                  costs.hasBills
                    ? "Las que registraste empiezan después o ya terminaron. Cambia de mes para verlas."
                    : "Registra lo que pagas por cada servicio —el plan de Vercel, la licencia de WhatsApp, el dominio— y se suma solo cada mes."
                }
              />
            ) : (
              costs.bills.map((bill) => (
                <CrmDataListRow
                  key={bill.id}
                  actions={
                    canManageTeam ? (
                      <CrmRowActions>
                        <CrmRowEdit onClick={() => openEdit(bill)} />
                        <CrmRowDelete onClick={() => remove(bill)} />
                      </CrmRowActions>
                    ) : undefined
                  }
                >
                  <div className="min-w-0 flex-1 basis-64 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                      <span>
                        {bill.label}
                        {bill.label !== bill.serviceName ? (
                          <span className="font-normal text-muted-foreground"> · {bill.serviceName}</span>
                        ) : null}
                      </span>
                      {bill.upcoming ? <Badge variant="outline">Aún no empieza</Badge> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{billWhen(bill)}</p>
                    {bill.note ? <p className="text-xs text-muted-foreground">{bill.note}</p> : null}
                  </div>
                  <div className="sm:w-40 sm:text-right">
                    <p className="text-sm font-medium tabular-nums">{formatBillAmount(bill.amountMinor, bill.currency)}</p>
                    {!bill.upcoming && (bill.cadence === "YEARLY" || bill.currency !== "USD") ? (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatUsdCents(bill.monthUsdCents)} este mes
                      </p>
                    ) : null}
                  </div>
                </CrmDataListRow>
              ))
            )}
          </CrmDataList>
        </section>

        <p className="text-xs text-muted-foreground">
          Los totales están en dólares; los pesos se convierten a {COP_FMT.format(costs.usdToCop)} COP por dólar (la tasa
          de Ajustes). Una factura anual se reparte en doce meses. Lo marcado «Aproximado» es un cálculo: las comisiones,
          con la tarifa configurada de PayPal y Mercado Pago sobre lo cobrado; la IA, con el precio de lista y solo las
          respuestas de WhatsApp (si registras la factura de Google, esa es la que vale).
        </p>
      </div>

      <CrmModal title={form?.id ? "Editar factura" : "Registrar factura"} open={form !== null} onClose={() => setForm(null)}>
        {form && selected ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="space-y-1.5">
              <Label>Servicio</Label>
              <Select
                value={form.serviceId}
                onValueChange={(value) =>
                  setForm((f) => (f && typeof value === "string" ? { ...f, serviceId: value as CostServiceId } : f))
                }
              >
                <SelectTrigger aria-label="Servicio" className="w-full">
                  <SelectValue>{(value) => COST_SERVICES[value as CostServiceId]?.name ?? String(value)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COST_SERVICE_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {COST_SERVICES[id].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selected.billing}
                {selected.billingUrl ? (
                  <>
                    {" "}
                    <a
                      href={selected.billingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-2"
                    >
                      Ver la factura en {selected.name}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </>
                ) : null}
              </p>
            </div>

            <CrmField label="Concepto" description="Opcional. Si lo dejas vacío, lleva el nombre del servicio.">
              <Input
                value={form.label}
                maxLength={80}
                placeholder="Plan Pro"
                onChange={(e) => setForm((f) => (f ? { ...f, label: e.target.value } : f))}
              />
            </CrmField>

            <div className="grid grid-cols-[1fr_auto] gap-3">
              <CrmField label="Monto">
                <Input
                  value={form.amount}
                  inputMode="decimal"
                  placeholder={form.currency === "COP" ? "85000" : "20.00"}
                  onChange={(e) => setForm((f) => (f ? { ...f, amount: e.target.value } : f))}
                />
              </CrmField>
              <div className="space-y-1.5">
                <Label>Moneda</Label>
                <Select
                  value={form.currency}
                  onValueChange={(value) =>
                    setForm((f) => (f && typeof value === "string" ? { ...f, currency: value as CostCurrency } : f))
                  }
                >
                  <SelectTrigger aria-label="Moneda">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COST_CURRENCIES.map((currency) => (
                      <SelectItem key={currency} value={currency}>
                        {currency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Cada cuánto se paga</Label>
              <Select
                value={form.cadence}
                onValueChange={(value) =>
                  setForm((f) => (f && typeof value === "string" ? { ...f, cadence: value as CostCadence } : f))
                }
              >
                <SelectTrigger aria-label="Cada cuánto se paga" className="w-full">
                  <SelectValue>{(value) => CADENCE_LABEL[value as CostCadence] ?? String(value)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COST_CADENCES.map((cadence) => (
                    <SelectItem key={cadence} value={cadence}>
                      {CADENCE_LABEL[cadence]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <CrmField label={form.cadence === "ONE_TIME" ? "Fecha del cobro" : "Desde"}>
                <Input
                  type="date"
                  value={form.startsOn}
                  onChange={(e) => setForm((f) => (f ? { ...f, startsOn: e.target.value } : f))}
                />
              </CrmField>
              {form.cadence !== "ONE_TIME" ? (
                <CrmField label="Hasta" description="Vacío si se sigue pagando.">
                  <Input
                    type="date"
                    value={form.endsOn}
                    min={form.startsOn || undefined}
                    onChange={(e) => setForm((f) => (f ? { ...f, endsOn: e.target.value } : f))}
                  />
                </CrmField>
              ) : null}
            </div>

            <CrmField label="Nota" description="Opcional.">
              <Textarea
                className="min-h-16"
                value={form.note}
                maxLength={300}
                onChange={(e) => setForm((f) => (f ? { ...f, note: e.target.value } : f))}
              />
            </CrmField>

            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}

            <CrmFormActions>
              <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </CrmFormActions>
          </form>
        ) : null}
      </CrmModal>
    </CrmPageShell>
  );
};

export default CostsPageClient;
