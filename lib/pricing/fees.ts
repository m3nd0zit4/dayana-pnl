/**
 * Gross-up de comisiones de pago.
 *
 * Idea: `plan.amountUsd` es lo que Dayana quiere recibir NETO.
 * Al cobrar, le sumamos la comisión del procesador para que después
 * del descuento llegue exactamente el neto.
 *
 * Fórmula: gross = (net + fixed) / (1 - percent)
 * Así, gross * (1 - percent) - fixed = net.
 */

export type FeeConfig = {
  percent: number;
  fixed: number;
};

export type FeeBreakdown = {
  net: number;
  fee: number;
  gross: number;
};

const num = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Comisión de PayPal (cross-border, Colombia recibiendo USD).
 * Default conservador: 5.4% + USD 0.30.
 */
export const paypalFee = (): FeeConfig => ({
  percent: num(process.env.PAYPAL_FEE_PERCENT, 0.054),
  fixed: num(process.env.PAYPAL_FEE_FIXED, 0.3),
});

/**
 * Comisión de Mercado Pago Colombia (Checkout Pro, acreditación inmediata).
 * Default ~4.75% (3.99% + IVA 19%). Sin componente fijo.
 */
export const mercadoPagoFee = (): FeeConfig => ({
  percent: num(process.env.MERCADOPAGO_FEE_PERCENT, 0.0475),
  fixed: num(process.env.MERCADOPAGO_FEE_FIXED, 0),
});

/**
 * Comisión de Stripe (tarjetas internacionales + Managed Payments como
 * merchant of record). Default conservador: 6.5% + USD 0.30.
 *
 * Ojo: a diferencia de PayPal/MP, este gross-up NO se calcula por petición —
 * Checkout cobra objetos `Price`, así que el importe ya viene con la comisión
 * horneada desde `scripts/stripe/setup-products.ts`. Cambiar estos valores
 * exige volver a correr ese script.
 */
export const stripeFee = (): FeeConfig => ({
  percent: num(process.env.STRIPE_FEE_PERCENT, 0.065),
  fixed: num(process.env.STRIPE_FEE_FIXED, 0.3),
});

/**
 * Comisión de Lemon Squeezy como merchant of record: 5% + USD 0.50.
 *
 * A diferencia de `stripeFee()`, este gross-up SÍ se calcula por petición: LS
 * acepta `custom_price` en cada checkout, así que cambiar estos valores tiene
 * efecto inmediato y no exige volver a correr ningún script. Igual que PayPal
 * y Mercado Pago.
 */
export const lemonSqueezyFee = (): FeeConfig => ({
  percent: num(process.env.LEMONSQUEEZY_FEE_PERCENT, 0.05),
  fixed: num(process.env.LEMONSQUEEZY_FEE_FIXED, 0.5),
});

/** Redondeo a 2 decimales (USD). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Gross-up con redondeo a 2 decimales (USD).
 * El `fee` devuelto = gross - net, así subtotal + fee = total exacto.
 */
export const grossUpUsd = (net: number, fee: FeeConfig): FeeBreakdown => {
  if (!Number.isFinite(net) || net <= 0) {
    return { net: 0, fee: 0, gross: 0 };
  }
  if (fee.percent <= 0 && fee.fixed <= 0) {
    return { net: round2(net), fee: 0, gross: round2(net) };
  }
  const rawGross = (net + fee.fixed) / (1 - fee.percent);
  const gross = round2(rawGross);
  const netRounded = round2(net);
  return {
    net: netRounded,
    fee: round2(gross - netRounded),
    gross,
  };
};

/** Gross-up para enteros (COP, sin decimales). */
export const grossUpInt = (net: number, fee: FeeConfig): FeeBreakdown => {
  if (!Number.isFinite(net) || net <= 0) {
    return { net: 0, fee: 0, gross: 0 };
  }
  if (fee.percent <= 0 && fee.fixed <= 0) {
    const rounded = Math.round(net);
    return { net: rounded, fee: 0, gross: rounded };
  }
  const rawGross = (net + fee.fixed) / (1 - fee.percent);
  const gross = Math.round(rawGross);
  const netRounded = Math.round(net);
  return {
    net: netRounded,
    fee: gross - netRounded,
    gross,
  };
};
