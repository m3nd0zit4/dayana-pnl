import { COST_SERVICE_IDS, COST_SERVICES, isCostServiceId, type CostServiceId } from "./catalog";
import {
  billAmountForMonth,
  billAppliesTo,
  combineCost,
  monthOf,
  toUsdCents,
  type BillLike,
  type CombinedCost,
  type CostCadence,
  type CostCurrency,
} from "./rules";

/**
 * Arma lo que pinta `/admin/costos` a partir de lo automático (proveedores,
 * uso propio), los planes fijos y lo apuntado a mano. Puro: `store.ts` trae
 * los datos, `preview.ts` trae datos de mentira, y los dos pasan por aquí —
 * así la vista previa y la pantalla real no pueden divergir en cómo se suman
 * las cosas.
 */

/** Una factura: apuntada a mano (`platform_costs`) o un plan fijo (`fixed`). */
export type CostBill = BillLike & {
  id: string;
  serviceId: string;
  label: string;
  note: string | null;
  /** Viene de `fixed-plans.ts`: no se edita desde la pantalla. */
  fixed?: boolean;
};

/** Lo que salió solo para un servicio en un mes. */
export type MeasuredCost = {
  usdCents: number;
  /** `exact`: lo que el proveedor facturó. `estimate`: uso × tarifa publicada. */
  kind: "exact" | "estimate";
};

export type MonthFacts = {
  measured: Partial<Record<CostServiceId, MeasuredCost>>;
  /** Cuánto se usó, en palabras: «773 correos enviados». */
  activity: Partial<Record<CostServiceId, string>>;
};

/** Por qué un servicio no tiene (o puede no tener al día) su cifra automática. */
export type ServiceStatus = {
  state: "missing_key" | "missing_price" | "error" | "stale";
  message: string;
};

export type CostServiceRow = {
  id: CostServiceId;
  name: string;
  what: string;
  /** Lo que cuenta este mes, en centavos de dólar. */
  usdCents: number;
  source: CombinedCost["source"];
  /** Lo automático, aunque lo apuntado mande: se enseña como referencia. */
  measured: MeasuredCost | null;
  /** La parte de facturas es toda de planes fijos (ninguna apuntada a mano). */
  fixedOnly: boolean;
  activity: string | null;
  status: ServiceStatus | null;
};

export type CostBillRow = {
  id: string;
  serviceId: CostServiceId;
  serviceName: string;
  label: string;
  cadence: CostCadence;
  currency: CostCurrency;
  amountMinor: number;
  startsOn: string;
  endsOn: string | null;
  note: string | null;
  /** Lo que pesa en el mes mostrado, en centavos de dólar. */
  monthUsdCents: number;
  /** Todavía no empieza: no suma en ningún mes que se pueda mirar. */
  upcoming: boolean;
  /** Plan fijo de `fixed-plans.ts`: se ve, no se edita. */
  fixed: boolean;
};

export type CostsMonth = {
  month: string;
  currentMonth: string;
  usdToCop: number;
  totalUsdCents: number;
  /** La parte del total que salió sola: proveedores, uso propio y planes fijos. */
  autoUsdCents: number;
  /** La parte del total apuntada a mano. */
  manualUsdCents: number;
  /** El total del mes anterior, para la variación. */
  previousUsdCents: number;
  /** Los últimos meses, del más viejo al mostrado. */
  trend: { month: string; usdCents: number }[];
  services: CostServiceRow[];
  /**
   * Planes fijos y cosas apuntadas a mano que cuentan en el mes mostrado. En
   * el mes actual se añaden las apuntadas que empiezan más adelante
   * (`upcoming`): no se puede navegar al futuro, y sin esto una con la fecha
   * mal puesta no se podría ver ni corregir.
   */
  bills: CostBillRow[];
  /** Cuántos servicios esperan una clave o un precio: el total está incompleto. */
  pending: number;
};

const serviceOf = (bill: Pick<CostBill, "serviceId">): CostServiceId =>
  isCostServiceId(bill.serviceId) ? bill.serviceId : "otro";

const EMPTY: MonthFacts = { measured: {}, activity: {} };

type ServiceSum = CombinedCost & {
  fromFixed: number;
  fromManual: number;
  fromMeasured: number;
  /** Hay un plan fijo que cuenta este mes y nada apuntado a mano (un plan gratuito pesa 0 y también cuenta). */
  fixedOnly: boolean;
};

type MonthSums = {
  total: number;
  auto: number;
  manual: number;
  byService: Record<CostServiceId, ServiceSum>;
};

const sumMonth = (month: string, bills: CostBill[], facts: MonthFacts, usdToCop: number): MonthSums => {
  const fixed = new Map<CostServiceId, number>();
  const manual = new Map<CostServiceId, number>();
  for (const bill of bills) {
    if (!billAppliesTo(bill, month)) continue;
    const id = serviceOf(bill);
    const into = bill.fixed ? fixed : manual;
    into.set(id, (into.get(id) ?? 0) + toUsdCents(billAmountForMonth(bill, month), bill.currency, usdToCop));
  }

  const sums: MonthSums = { total: 0, auto: 0, manual: 0, byService: {} as Record<CostServiceId, ServiceSum> };
  for (const id of COST_SERVICE_IDS) {
    const fromFixed = fixed.get(id) ?? null;
    const fromManual = manual.get(id) ?? null;
    const billed = fromFixed == null && fromManual == null ? null : (fromFixed ?? 0) + (fromManual ?? 0);
    const measured = facts.measured[id]?.usdCents ?? null;
    const combined = combineCost(COST_SERVICES[id].combine, billed, measured);
    const countsBills = combined.source === "bill" || combined.source === "both";
    const countsMeasured = combined.source === "measured" || combined.source === "both";
    const row: ServiceSum = {
      ...combined,
      fromFixed: countsBills ? (fromFixed ?? 0) : 0,
      fromManual: countsBills ? (fromManual ?? 0) : 0,
      fromMeasured: countsMeasured ? (measured ?? 0) : 0,
      fixedOnly: countsBills && fromFixed != null && fromManual == null,
    };
    sums.byService[id] = row;
    sums.total += combined.usdCents;
    sums.auto += row.fromFixed + row.fromMeasured;
    sums.manual += row.fromManual;
  }
  return sums;
};

export const buildCostsMonth = (input: {
  month: string;
  currentMonth: string;
  /** Los meses de la tendencia, del más viejo al mostrado (el último es `month`). */
  months: string[];
  usdToCop: number;
  /** Planes fijos (con `fixed: true`) y lo apuntado a mano, juntos. */
  bills: CostBill[];
  factsByMonth: Record<string, MonthFacts>;
  /** Servicios cuya cifra automática falta o no se pudo actualizar. */
  status?: Partial<Record<CostServiceId, ServiceStatus>>;
}): CostsMonth => {
  const { month, bills, usdToCop } = input;
  const status = input.status ?? {};
  const factsOf = (m: string) => input.factsByMonth[m] ?? EMPTY;

  const trend = input.months.map((m) => ({
    month: m,
    usdCents: sumMonth(m, bills, factsOf(m), usdToCop).total,
  }));

  const facts = factsOf(month);
  const sums = sumMonth(month, bills, facts, usdToCop);

  const services: CostServiceRow[] = COST_SERVICE_IDS.map((id) => ({
    id,
    name: COST_SERVICES[id].name,
    what: COST_SERVICES[id].what,
    usdCents: sums.byService[id].usdCents,
    source: sums.byService[id].source,
    measured: facts.measured[id] ?? null,
    fixedOnly: sums.byService[id].fixedOnly,
    activity: facts.activity[id] ?? null,
    status: status[id] ?? null,
  }))
    // Un servicio sin cifra, sin uso y sin nada pendiente no dice nada: fuera
    // (Twilio sin conectar, «Otro» sin nada apuntado).
    .filter((row) => row.source !== "none" || row.status != null || row.activity != null)
    // Lo que más cuesta, arriba; lo que no tiene cifra, al final. `sort` es
    // estable, así que los empates conservan el orden del catálogo.
    .sort((a, b) => {
      const known = Number(b.source !== "none") - Number(a.source !== "none");
      return known !== 0 ? known : b.usdCents - a.usdCents;
    });

  const isUpcoming = (bill: CostBill) =>
    !bill.fixed && month === input.currentMonth && monthOf(bill.startsOn) > month;

  const billRows: CostBillRow[] = bills
    .filter((bill) => billAppliesTo(bill, month) || isUpcoming(bill))
    .map((bill) => {
      const serviceId = serviceOf(bill);
      return {
        id: bill.id,
        serviceId,
        serviceName: COST_SERVICES[serviceId].name,
        label: bill.label,
        cadence: bill.cadence,
        currency: bill.currency,
        amountMinor: bill.amountMinor,
        startsOn: bill.startsOn,
        endsOn: bill.endsOn,
        note: bill.note,
        monthUsdCents: toUsdCents(billAmountForMonth(bill, month), bill.currency, usdToCop),
        upcoming: isUpcoming(bill),
        fixed: bill.fixed === true,
      };
    })
    // Las que cuentan, de mayor a menor; las que aún no empiezan, al final.
    .sort((a, b) => Number(a.upcoming) - Number(b.upcoming) || b.monthUsdCents - a.monthUsdCents);

  return {
    month,
    currentMonth: input.currentMonth,
    usdToCop,
    totalUsdCents: sums.total,
    autoUsdCents: sums.auto,
    manualUsdCents: sums.manual,
    previousUsdCents: trend.length >= 2 ? trend[trend.length - 2].usdCents : 0,
    trend,
    services,
    bills: billRows,
    pending: services.filter((row) => row.status?.state === "missing_key" || row.status?.state === "missing_price").length,
  };
};
