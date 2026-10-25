import type { Plan } from "@/lib/plans";

/**
 * Cobros con monto libre — la parte pura (sin base de datos).
 *
 * Un enlace de pago normal cobra el precio de un producto del catálogo. Este
 * cobra el monto que Dayana escribió al crearlo: un abono, una diferencia, un
 * precio acordado por teléfono. Para que PayPal, Mercado Pago, la cotización y
 * los webhooks lo traten como cualquier otro cobro sin tocar cada uno, el
 * enlace se comporta como un **plan con id propio**: `enlace-<id del enlace>`.
 * Ese id viaja por la referencia firmada igual que `therapy-6`, y el único
 * sitio que cambia es el portón que traduce un id en un plan
 * (`getPlanFromDb`), que aquí lo lee del enlace en vez del catálogo.
 *
 * La matrícula y el pago, en cambio, necesitan un producto REAL al que
 * colgarse (la clave foránea): el producto oculto `pago-personalizado`.
 */

/** Producto real, oculto e inactivo, al que cuelgan todos los cobros libres. */
export const CUSTOM_PAYMENT_PRODUCT_ID = "pago-personalizado";

/**
 * Prefijo del id de plan de un enlace libre. Ningún producto real empieza así
 * (los ids del catálogo son `therapy-N`, `course-*`, `taller-*`), y es distinto
 * de `pago-personalizado` a propósito para que el producto oculto nunca se lea
 * como un enlace.
 */
export const CUSTOM_PLAN_PREFIX = "enlace-";

export const CUSTOM_CURRENCIES = ["USD", "COP"] as const;
export type CustomCurrency = (typeof CUSTOM_CURRENCIES)[number];

/**
 * Tope y suelo por moneda, en las unidades del enlace (USD en centavos, COP en
 * pesos). No son una regla de negocio: son la red contra un cero de más al
 * teclear. Un enlace de 5.000 USD en vez de 500 sale y se paga.
 */
export const CUSTOM_AMOUNT_LIMITS: Record<
  CustomCurrency,
  { min: number; max: number }
> = {
  USD: { min: 100, max: 1_000_000 },
  COP: { min: 5_000, max: 40_000_000 },
};

export const CUSTOM_CONCEPT_MAX = 140;

export const customPlanIdFor = (linkId: string): string =>
  `${CUSTOM_PLAN_PREFIX}${linkId}`;

/** El id del enlace dentro de un id de plan libre, o `null` si no lo es. */
export const parseCustomPlanId = (planId: string): string | null => {
  if (!planId.startsWith(CUSTOM_PLAN_PREFIX)) return null;
  const linkId = planId.slice(CUSTOM_PLAN_PREFIX.length);
  // Un cuid: minúsculas y dígitos. Cualquier otra cosa no es un enlace, y no se
  // le pregunta a la base de datos por ella.
  return /^[a-z0-9]{8,40}$/.test(linkId) ? linkId : null;
};

export const isCustomPlanId = (planId?: string | null): boolean =>
  planId != null && parseCustomPlanId(planId) !== null;

/** Qué riel cobra cada moneda. PayPal sólo cobra USD y Mercado Pago, COP. */
export const providerForCurrency = (
  currency: CustomCurrency,
): "paypal" | "mercadopago" => (currency === "COP" ? "mercadopago" : "paypal");

export type CustomAmountError =
  | "invalid_currency"
  | "invalid_amount"
  | "amount_too_small"
  | "amount_too_large";

export type CustomAmountResult =
  | { ok: true; currency: CustomCurrency; amountMinor: number }
  | { ok: false; error: CustomAmountError };

const isCustomCurrency = (value: unknown): value is CustomCurrency =>
  (CUSTOM_CURRENCIES as readonly unknown[]).includes(value);

/**
 * Del monto que escribe una persona (`250.50` USD, `500000` COP) a las
 * unidades guardadas. La conversión es SIEMPRE del servidor: el navegador manda
 * lo tecleado y nunca centavos ya multiplicados.
 *
 * USD admite hasta dos decimales; COP, ninguno (se guarda en pesos enteros). Un
 * `250.505` se rechaza en vez de redondearse: el importe que se cobra tiene que
 * ser el que ella escribió.
 */
export const customAmountToMinor = (
  amount: unknown,
  currency: unknown,
): CustomAmountResult => {
  if (!isCustomCurrency(currency)) {
    return { ok: false, error: "invalid_currency" };
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "invalid_amount" };
  }

  let amountMinor: number;
  if (currency === "COP") {
    if (!Number.isInteger(amount)) return { ok: false, error: "invalid_amount" };
    amountMinor = amount;
  } else {
    amountMinor = Math.round(amount * 100);
    if (Math.abs(amount * 100 - amountMinor) > 1e-6) {
      return { ok: false, error: "invalid_amount" };
    }
  }

  const { min, max } = CUSTOM_AMOUNT_LIMITS[currency];
  if (amountMinor < min) return { ok: false, error: "amount_too_small" };
  if (amountMinor > max) return { ok: false, error: "amount_too_large" };
  return { ok: true, currency, amountMinor };
};

/**
 * Del texto que se teclea en el formulario al número que se manda al servidor,
 * o `null` si es ambiguo. Estricto a propósito: el riesgo real de un monto libre
 * no es un error de código sino un «500.000» leído como 500.
 *
 * - **COP**: punto y coma son SEPARADORES DE MILES (`500.000`, `1,250,000`) y
 *   sólo se aceptan en grupos de tres. `500.5` no es un monto en pesos: se
 *   rechaza en vez de leerse como 5005.
 * - **USD**: `250`, `250.50`, `250,50` (coma decimal) y `1,250.50` (coma de
 *   miles). `1.250` —que en español es mil doscientos cincuenta— se rechaza
 *   por ambiguo.
 */
export const parseTypedAmount = (
  text: string,
  currency: CustomCurrency,
): number | null => {
  const raw = text.replace(/[\s$]/g, "");
  if (!raw) return null;

  if (currency === "COP") {
    if (!/^(\d{1,3}([.,]\d{3})+|\d+)$/.test(raw)) return null;
    return Number(raw.replace(/[.,]/g, ""));
  }

  let normalized = raw;
  if (raw.includes(".") && raw.includes(",")) normalized = raw.replace(/,/g, "");
  else if (raw.includes(",")) normalized = raw.replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : null;
};

/** El concepto limpio, o `null` si no sirve (vacío o más largo que el tope). */
export const cleanCustomConcept = (concept: unknown): string | null => {
  if (typeof concept !== "string") return null;
  const clean = concept.replace(/\s+/g, " ").trim();
  return clean && clean.length <= CUSTOM_CONCEPT_MAX ? clean : null;
};

/**
 * El monto sin el código de moneda: `$250.50` / `$500.000`. Con centavos en
 * USD, que `formatUsd` redondea a dólares enteros (`$250.50` saldría `$251`).
 * Para los sitios que ya añaden el código aparte («por $250.50 USD»).
 */
export const formatBareAmount = (
  amountMinor: number,
  currency: CustomCurrency,
): string =>
  currency === "COP"
    ? new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(amountMinor)
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amountMinor / 100);

/** El monto con su moneda, tal como se lee en la página: `$250.50 USD`. */
export const formatCustomAmount = (
  amountMinor: number,
  currency: CustomCurrency,
): string => `${formatBareAmount(amountMinor, currency)} ${currency}`;

/**
 * Cómo se busca la matrícula de un plan en la tabla `enrollments`.
 *
 * Un producto normal se encuentra por su `productId`. Un cobro libre NO: todos
 * cuelgan del mismo producto oculto, así que buscar sólo por él mezclaría los
 * cobros de enlaces distintos de la misma persona (el aviso pendiente de uno
 * se pegaría a la matrícula ya pagada de otro). Lo que los distingue es el id
 * del enlace, que `createEnrollment` guarda en `externalRef`.
 */
export const enrollmentKeyForPlan = (
  planId: string,
): { productId: string; externalRef?: string } => {
  const linkId = parseCustomPlanId(planId);
  return linkId
    ? { productId: CUSTOM_PAYMENT_PRODUCT_ID, externalRef: linkId }
    : { productId: planId };
};

/** Lo que de un enlace hace falta para construir su plan. */
export type CustomLinkTerms = {
  id: string;
  customAmountMinor: number | null;
  customCurrency: string | null;
  customConcept: string | null;
};

export type ResolvedCustomTerms = {
  linkId: string;
  amountMinor: number;
  currency: CustomCurrency;
  concept: string;
};

/** Las condiciones del enlace, o `null` si le falta alguna (no es un enlace libre). */
export const customTermsFromLink = (
  link: CustomLinkTerms,
): ResolvedCustomTerms | null => {
  const concept = link.customConcept?.trim();
  if (
    !concept ||
    !isCustomCurrency(link.customCurrency) ||
    !link.customAmountMinor ||
    link.customAmountMinor <= 0
  ) {
    return null;
  }
  return {
    linkId: link.id,
    amountMinor: link.customAmountMinor,
    currency: link.customCurrency,
    concept,
  };
};

/**
 * El plan de un enlace libre. `amountUsd` va en dólares (como el resto de los
 * planes) y `amountCop` en pesos. Sólo se rellena la moneda del enlace: la
 * otra queda en 0 / sin definir, y es eso lo que impide cobrar un enlace en USD
 * por Mercado Pago o uno en COP por PayPal — nunca se deriva una de la otra.
 */
export const customPlanFromTerms = (terms: ResolvedCustomTerms): Plan => {
  const usd = terms.currency === "USD";
  return {
    id: customPlanIdFor(terms.linkId),
    kind: "course",
    title: terms.concept,
    sessions: "Pago único",
    amountUsd: usd ? terms.amountMinor / 100 : 0,
    amountCop: usd ? undefined : terms.amountMinor,
    features: [],
    whatsappMessage: `Hola Dayana, tengo una pregunta sobre mi pago: ${terms.concept}.`,
  };
};
