import { COST_SERVICES, isCostServiceId, type CostService, type CostServiceId } from "./catalog";

/**
 * Las cuentas de la pantalla de Costos. Puro: sin base de datos ni reloj.
 *
 * Unidades, las mismas que `Payment` y `ProductPrice`: **USD en centavos, COP
 * en pesos enteros**. Los totales se llevan a centavos de dólar con la tasa
 * del CRM (`resolveUsdToCopRate`) para poder sumar las dos monedas en una sola
 * cifra; cada fila conserva además su importe original.
 */

export const COST_CADENCES = ["MONTHLY", "YEARLY", "ONE_TIME"] as const;
export type CostCadence = (typeof COST_CADENCES)[number];

export const COST_CURRENCIES = ["USD", "COP"] as const;
export type CostCurrency = (typeof COST_CURRENCIES)[number];

export const CADENCE_LABEL: Record<CostCadence, string> = {
  MONTHLY: "Cada mes",
  YEARLY: "Cada año",
  ONE_TIME: "Una sola vez",
};

/** Lo mínimo de una factura para hacer cuentas con ella. */
export type BillLike = {
  serviceId: string;
  cadence: CostCadence;
  currency: CostCurrency;
  amountMinor: number;
  /** `YYYY-MM-DD`. En `ONE_TIME`, la fecha del cobro. */
  startsOn: string;
  /** `YYYY-MM-DD` o null (sigue vigente). */
  endsOn: string | null;
};

// ── Meses ───────────────────────────────────────────────────────────────────

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isMonthKey = (value: unknown): value is string =>
  typeof value === "string" && MONTH_KEY.test(value);

/** `YYYY-MM-DD` que además existe en el calendario (no «2026-02-31»). */
export const isDateKey = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

export const monthOf = (dateKey: string): string => dateKey.slice(0, 7);

export const addMonths = (monthKey: string, delta: number): string => {
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Los `count` meses que terminan en `monthKey`, del más viejo al más nuevo. */
export const monthsEndingAt = (monthKey: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => addMonths(monthKey, i - (count - 1)));

/**
 * El mes pedido en la URL, o el actual si no viene, no es un mes o es futuro:
 * de un mes que no ha empezado no hay nada que mostrar.
 */
export const resolveMonth = (requested: unknown, currentMonth: string): string =>
  isMonthKey(requested) && requested <= currentMonth ? requested : currentMonth;

const MONTH_NAME = new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" });

/** «noviembre de 2026». */
export const monthLabel = (monthKey: string): string => {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_NAME.format(new Date(Date.UTC(y, m - 1, 1)))} de ${y}`;
};

// ── Facturas ────────────────────────────────────────────────────────────────

const daysInMonth = (monthKey: string): number => {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * ¿El mes en que termina la factura todavía cuenta?
 *
 * Solo si ese mes llegó a cobrarse: una mensual que se cobra los días 10 y se
 * canceló el 9 de abril no pagó abril. Una anual se reparte en doce partes
 * desde su mes de inicio, así que el mes del aniversario ya es del año
 * siguiente: del 10 de marzo al 10 de marzo son doce meses, no trece.
 */
const endMonthCounts = (bill: BillLike, endsOn: string): boolean => {
  const endDay = Number(endsOn.slice(8, 10));
  // Un cobro del día 31 cae el 30 (o el 28) en los meses cortos.
  const chargeDay = Math.min(Number(bill.startsOn.slice(8, 10)), daysInMonth(monthOf(endsOn)));
  return bill.cadence === "YEARLY" ? endDay > chargeDay : endDay >= chargeDay;
};

/** ¿Esta factura cuenta en este mes? */
export const billAppliesTo = (bill: BillLike, monthKey: string): boolean => {
  const start = monthOf(bill.startsOn);
  if (bill.cadence === "ONE_TIME") return start === monthKey;
  if (monthKey < start) return false;
  // El mes en que empezó se pagó, aunque se cancelara ese mismo mes.
  if (bill.endsOn == null || monthKey === start) return true;
  const end = monthOf(bill.endsOn);
  return monthKey < end || (monthKey === end && endMonthCounts(bill, bill.endsOn));
};

/**
 * Lo que la factura pesa en ese mes, en su propia moneda.
 *
 * Una anual se reparte en doce partes: la pregunta de la pantalla es «cuánto
 * cuesta la plataforma al mes», y cargar el dominio entero en el mes en que se
 * renueva haría parecer ese mes carísimo y los otros once, gratis.
 */
export const billAmountForMonth = (bill: BillLike, monthKey: string): number => {
  if (!billAppliesTo(bill, monthKey)) return 0;
  return bill.cadence === "YEARLY" ? bill.amountMinor / 12 : bill.amountMinor;
};

/**
 * La comisión de unos pagos que no la traen guardada, con la tarifa
 * configurada (`lib/pricing/fees.ts`): porcentaje sobre lo cobrado más un
 * fijo por pago. Devuelve unidades menores de esa moneda. `fixed` viene en
 * unidades mayores (0.30 = 30 centavos de dólar; en pesos no hay diferencia).
 */
export const estimateFeeMinor = (
  amountMinor: number,
  payments: number,
  fee: { percent: number; fixed: number },
  currency: CostCurrency,
): number => amountMinor * fee.percent + payments * fee.fixed * (currency === "USD" ? 100 : 1);

/** A centavos de dólar. COP son pesos enteros: se dividen por la tasa. */
export const toUsdCents = (amountMinor: number, currency: CostCurrency, usdToCop: number): number =>
  currency === "USD" ? amountMinor : usdToCop > 0 ? (amountMinor / usdToCop) * 100 : 0;

export type CombinedCost = {
  usdCents: number;
  /** De dónde sale la cifra del mes. */
  source: "bill" | "measured" | "both" | "none";
};

/**
 * La cifra del mes de un servicio a partir de sus facturas y de lo medido.
 * `null` = no hay (ni factura, ni medición). Un `0` medido sí cuenta como dato.
 */
export const combineCost = (
  policy: CostService["combine"],
  billUsdCents: number | null,
  measuredUsdCents: number | null,
): CombinedCost => {
  if (billUsdCents == null && measuredUsdCents == null) return { usdCents: 0, source: "none" };
  if (billUsdCents == null) return { usdCents: measuredUsdCents ?? 0, source: "measured" };
  if (measuredUsdCents == null) return { usdCents: billUsdCents, source: "bill" };
  return policy === "sum"
    ? { usdCents: billUsdCents + measuredUsdCents, source: "both" }
    : { usdCents: billUsdCents, source: "bill" };
};

// ── Lo que escribe una persona ──────────────────────────────────────────────

/**
 * El importe tal como se teclea, a unidades menores. `null` si no es un
 * importe válido mayor que cero.
 *
 * - USD: «20», «20.5», «20,50», «1,234.56» → centavos.
 * - COP: «85000», «85.000», «85,000», «$ 85.000» → pesos enteros. Los puntos y
 *   las comas son separadores de miles; unos centavos al final («85.000,00»,
 *   como los imprime una factura) se descartan: en pesos no se guardan.
 */
export const parseAmountInput = (text: string, currency: CostCurrency): number | null => {
  const clean = text.replace(/[\s$]/g, "");
  if (!clean || !/^[\d.,]+$/.test(clean)) return null;

  if (currency === "COP") {
    // Un grupo de miles tiene siempre tres cifras, así que una o dos cifras
    // tras el último punto o coma solo pueden ser centavos.
    const pesos = Number(clean.replace(/[.,]\d{1,2}$/, "").replace(/[.,]/g, ""));
    return Number.isSafeInteger(pesos) && pesos > 0 ? pesos : null;
  }

  // El último punto o coma es el separador decimal solo si le siguen 1 o 2
  // cifras; «1,234» y «1.234» son miles.
  const match = clean.match(/^(.*?)(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  const whole = match[1].replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  const cents = Number(whole) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
};

/** Lo contrario de `parseAmountInput`, para rellenar el formulario al editar. */
export const amountInputValue = (amountMinor: number, currency: CostCurrency): string =>
  currency === "COP" ? String(amountMinor) : (amountMinor / 100).toFixed(2);

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const COP = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** «$12.50». Algo que existe pero no llega a un centavo se dice, no se redondea a cero. */
export const formatUsdCents = (usdCents: number): string => {
  if (usdCents > 0 && usdCents < 0.5) return "< $0.01";
  return USD.format(Math.round(usdCents) / 100);
};

/** El importe en su moneda: «$20.00 USD» o «$85.000 COP». */
export const formatBillAmount = (amountMinor: number, currency: CostCurrency): string =>
  currency === "COP" ? `$${COP.format(Math.round(amountMinor))} COP` : `${USD.format(amountMinor / 100)} USD`;

// ── Validación de lo que llega a la API ─────────────────────────────────────

/** Tope por factura: 1 000 000 USD o 2 000 000 000 COP (cabe en un entero de 32 bits). Más que eso es un dedo de más. */
const MAX_AMOUNT: Record<CostCurrency, number> = { USD: 100_000_000, COP: 2_000_000_000 };

export type BillInput = {
  serviceId: CostServiceId;
  label: string;
  cadence: CostCadence;
  currency: CostCurrency;
  amountMinor: number;
  startsOn: string;
  endsOn: string | null;
  note: string | null;
};

export type BillInputError =
  | "invalid_service"
  | "invalid_cadence"
  | "invalid_currency"
  | "invalid_amount"
  | "invalid_start"
  | "invalid_end"
  | "label_too_long"
  | "note_too_long";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Valida el cuerpo de crear/editar una factura. Nunca lanza. */
export const parseBillInput = (
  body: Record<string, unknown> | null | undefined,
): { ok: true; data: BillInput } | { ok: false; error: BillInputError } => {
  const fail = (error: BillInputError) => ({ ok: false as const, error });
  if (!body || !isCostServiceId(body.serviceId)) return fail("invalid_service");

  const cadence = body.cadence;
  if (typeof cadence !== "string" || !(COST_CADENCES as readonly string[]).includes(cadence)) {
    return fail("invalid_cadence");
  }
  const currency = body.currency;
  if (typeof currency !== "string" || !(COST_CURRENCIES as readonly string[]).includes(currency)) {
    return fail("invalid_currency");
  }

  const amountMinor = body.amountMinor;
  if (
    typeof amountMinor !== "number" ||
    !Number.isInteger(amountMinor) ||
    amountMinor <= 0 ||
    amountMinor > MAX_AMOUNT[currency as CostCurrency]
  ) {
    return fail("invalid_amount");
  }

  if (!isDateKey(body.startsOn)) return fail("invalid_start");

  // Un cobro suelto no «termina»: su fecha es la del cobro.
  let endsOn: string | null = null;
  if (cadence !== "ONE_TIME" && body.endsOn != null && body.endsOn !== "") {
    if (!isDateKey(body.endsOn) || body.endsOn < body.startsOn) return fail("invalid_end");
    endsOn = body.endsOn;
  }

  const label = text(body.label) || COST_SERVICES[body.serviceId].name;
  if (label.length > 80) return fail("label_too_long");
  const note = text(body.note);
  if (note.length > 300) return fail("note_too_long");

  return {
    ok: true,
    data: {
      serviceId: body.serviceId,
      label,
      cadence: cadence as CostCadence,
      currency: currency as CostCurrency,
      amountMinor,
      startsOn: body.startsOn,
      endsOn,
      note: note || null,
    },
  };
};
