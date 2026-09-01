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
