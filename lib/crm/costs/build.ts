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
 * Arma lo que pinta `/admin/costos` a partir de las facturas y de lo medido.
 * Puro: `store.ts` trae los datos, `preview.ts` trae datos de mentira, y los
 * dos pasan por aquí — así la vista previa y la pantalla real no pueden
 * divergir en cómo se suman las cosas.
 */

/** Una factura guardada, ya con fechas como texto. */
export type CostBill = BillLike & {
  id: string;
  serviceId: string;
  label: string;
  note: string | null;
};

/** Lo que la plataforma calculó sola para un servicio en un mes. */
export type MeasuredCost = {
  usdCents: number;
  kind: "exact" | "estimate";
  /** Si la cifra original estaba en pesos (comisiones de Mercado Pago). */
  copMinor?: number;
};

export type MonthFacts = {
  measured: Partial<Record<CostServiceId, MeasuredCost>>;
  /** Cuánto se usó, en palabras: «773 correos enviados». */
  activity: Partial<Record<CostServiceId, string>>;
};

export type CostServiceRow = {
  id: CostServiceId;
  name: string;
  what: string;
  billing: string;
  /** Lo que cuenta este mes, en centavos de dólar. */
  usdCents: number;
  source: CombinedCost["source"];
  /** Lo medido, aunque la factura mande: se enseña como referencia. */
  measured: MeasuredCost | null;
  activity: string | null;
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
};

export type CostsMonth = {
  month: string;
  currentMonth: string;
  usdToCop: number;
  totalUsdCents: number;
  /** La parte del total que viene de facturas registradas. */
  billsUsdCents: number;
  /** La parte del total que la plataforma midió sola. */
  measuredUsdCents: number;
  /** El total del mes anterior, para la variación. */
  previousUsdCents: number;
  /** Los últimos meses, del más viejo al mostrado. */
  trend: { month: string; usdCents: number }[];
  services: CostServiceRow[];
  /**
   * Facturas que cuentan en el mes mostrado. En el mes actual se añaden las
   * que empiezan más adelante (`upcoming`): no se puede navegar al futuro, y
   * sin esto una factura con la fecha mal puesta no se podría ver ni corregir.
   */
  bills: CostBillRow[];
  /** Si hay alguna factura registrada, en cualquier mes. */
  hasBills: boolean;
};

const serviceOf = (bill: Pick<CostBill, "serviceId">): CostServiceId =>
  isCostServiceId(bill.serviceId) ? bill.serviceId : "otro";

const EMPTY: MonthFacts = { measured: {}, activity: {} };

type MonthSums = {
  total: number;
  fromBills: number;
  fromMeasured: number;
  byService: Record<CostServiceId, CombinedCost>;
};

const sumMonth = (month: string, bills: CostBill[], facts: MonthFacts, usdToCop: number): MonthSums => {
  const billed = new Map<CostServiceId, number>();
  for (const bill of bills) {
    if (!billAppliesTo(bill, month)) continue;
    const id = serviceOf(bill);
    billed.set(id, (billed.get(id) ?? 0) + toUsdCents(billAmountForMonth(bill, month), bill.currency, usdToCop));
  }

  const sums: MonthSums = {
    total: 0,
    fromBills: 0,
    fromMeasured: 0,
    byService: {} as Record<CostServiceId, CombinedCost>,
  };
  for (const id of COST_SERVICE_IDS) {
    const bill = billed.get(id) ?? null;
    const measured = facts.measured[id]?.usdCents ?? null;
    const combined = combineCost(COST_SERVICES[id].combine, bill, measured);
    sums.byService[id] = combined;
    sums.total += combined.usdCents;
    if (combined.source === "bill" || combined.source === "both") sums.fromBills += bill ?? 0;
    if (combined.source === "measured" || combined.source === "both") sums.fromMeasured += measured ?? 0;
  }
  return sums;
};

export const buildCostsMonth = (input: {
  month: string;
  currentMonth: string;
  /** Los meses de la tendencia, del más viejo al mostrado (el último es `month`). */
  months: string[];
  usdToCop: number;
  bills: CostBill[];
  factsByMonth: Record<string, MonthFacts>;
}): CostsMonth => {
  const { month, bills, usdToCop } = input;
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
    billing: COST_SERVICES[id].billing,
    usdCents: sums.byService[id].usdCents,
    source: sums.byService[id].source,
    measured: facts.measured[id] ?? null,
    activity: facts.activity[id] ?? null,
  }))
    // «Otro» sin nada registrado no es un servicio: es un hueco del formulario.
    .filter((row) => row.id !== "otro" || row.source !== "none")
    // Lo que más cuesta, arriba; lo que no tiene cifra, al final. `sort` es
    // estable, así que los empates conservan el orden del catálogo.
    .sort((a, b) => {
      const known = Number(b.source !== "none") - Number(a.source !== "none");
      return known !== 0 ? known : b.usdCents - a.usdCents;
    });

  const isUpcoming = (bill: CostBill) => month === input.currentMonth && monthOf(bill.startsOn) > month;

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
      };
    })
    // Las que cuentan, de mayor a menor; las que aún no empiezan, al final.
    .sort((a, b) => Number(a.upcoming) - Number(b.upcoming) || b.monthUsdCents - a.monthUsdCents);

  return {
    month,
    currentMonth: input.currentMonth,
    usdToCop,
    totalUsdCents: sums.total,
    billsUsdCents: sums.fromBills,
    measuredUsdCents: sums.fromMeasured,
    previousUsdCents: trend.length >= 2 ? trend[trend.length - 2].usdCents : 0,
    trend,
    services,
    bills: billRows,
    hasBills: bills.length > 0,
  };
};
