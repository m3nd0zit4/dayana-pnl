import { describe, expect, test, afterEach } from "bun:test";

import { mercadoPagoItemAmount } from "./amount";
import type { Plan } from "../plans";

const ENV_KEYS = [
  "MERCADOPAGO_CURRENCY",
  "MERCADOPAGO_SELLER_COUNTRY",
  "MERCADOPAGO_FEE_PERCENT",
  "MERCADOPAGO_FEE_FIXED",
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const k of ENV_KEYS) savedEnv.set(k, process.env[k]);

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const basePlan: Plan = {
  id: "therapy-6",
  kind: "therapy",
  title: "Terapia",
  sessions: "6 sesiones",
  amountUsd: 189.9,
  amountCop: 189900,
  features: [],
  whatsappMessage: "",
};

describe("mercadoPagoItemAmount — vendedor en Colombia (checkout siempre en COP)", () => {
  test("con precio COP explícito, cobra en COP con gross-up de la comisión MP", () => {
    process.env.MERCADOPAGO_SELLER_COUNTRY = "CO";
    process.env.MERCADOPAGO_CURRENCY = "COP";
    delete process.env.MERCADOPAGO_FEE_PERCENT;
    delete process.env.MERCADOPAGO_FEE_FIXED;

    const result = mercadoPagoItemAmount(basePlan);
    expect(result.currency_id).toBe("COP");
    expect(result).toEqual({
      net: 189900,
      fee: 9470,
      gross: 199370,
      currency_id: "COP",
    });
  });

  test("con MERCADOPAGO_CURRENCY sin definir (default 'USD'), un vendedor CO igual cobra en COP pero YA trae referenceUsd", () => {
    // characterization: current behaviour, see report — `getMercadoPagoSiteCurrency()`
    // hace default a "USD" cuando el env no está definido. Como
    // `mercadoPagoCheckoutUsesCop()` ya fuerza COP por país de vendedor, el
    // resultado sigue siendo COP — pero el `siteCurrency === "USD"` implícito
    // dispara la rama de `referenceUsd` aunque nadie haya configurado el sitio
    // en USD explícitamente. En un despliegue que de verdad vende sólo en COP
    // habría que fijar MERCADOPAGO_CURRENCY=COP para no ver esta fila extra.
    process.env.MERCADOPAGO_SELLER_COUNTRY = "CO";
    delete process.env.MERCADOPAGO_CURRENCY;
    delete process.env.MERCADOPAGO_FEE_PERCENT;
    delete process.env.MERCADOPAGO_FEE_FIXED;

    const result = mercadoPagoItemAmount(basePlan);
    expect(result.currency_id).toBe("COP");
    expect(result.referenceUsd).toEqual({ net: 189.9, fee: 9.47, gross: 199.37 });
  });

  test("sin fila COP (amountCop null) lanza 'no_cop_price' — no hay checkout en COP sin precio explícito", () => {
    process.env.MERCADOPAGO_SELLER_COUNTRY = "CO";
    const plan: Plan = { ...basePlan, amountCop: undefined };
    expect(() => mercadoPagoItemAmount(plan)).toThrow("no_cop_price");
  });

  test("amountCop = 0 también cuenta como 'sin precio' y lanza", () => {
    process.env.MERCADOPAGO_SELLER_COUNTRY = "CO";
    const plan: Plan = { ...basePlan, amountCop: 0 };
    expect(() => mercadoPagoItemAmount(plan)).toThrow("no_cop_price");
  });

  test("cuando el sitio está en modo USD pero vende en Colombia, añade referenceUsd con su propio gross-up", () => {
    process.env.MERCADOPAGO_SELLER_COUNTRY = "CO";
    process.env.MERCADOPAGO_CURRENCY = "USD";

    const result = mercadoPagoItemAmount(basePlan);
    expect(result.currency_id).toBe("COP");
    // characterization: current behaviour, see report — `referenceUsd` uses
    // the SAME `mercadoPagoFee()` (4.75%, no fixed) as the COP breakdown, not
    // PayPal's fee, even though it's a USD reference figure. It's a display
    // reference of "what this would look like in USD if MP charged it", not
    // an amount actually charged through PayPal.
    expect(result.referenceUsd).toEqual({
      net: 189.9,
      fee: 9.47,
      gross: 199.37,
    });
  });

  test("referenceUsd se omite si amountUsd es 0", () => {
    process.env.MERCADOPAGO_SELLER_COUNTRY = "CO";
    process.env.MERCADOPAGO_CURRENCY = "USD";
    const plan: Plan = { ...basePlan, amountUsd: 0 };

    const result = mercadoPagoItemAmount(plan);
    expect(result.referenceUsd).toBeUndefined();
  });
});

describe("mercadoPagoItemAmount — vendedor fuera de Colombia, sitio en USD", () => {
  test("cobra en USD con gross-up de la comisión MP (no de PayPal)", () => {
    process.env.MERCADOPAGO_SELLER_COUNTRY = "MX";
    process.env.MERCADOPAGO_CURRENCY = "USD";

    const result = mercadoPagoItemAmount(basePlan);
    expect(result.currency_id).toBe("USD");
    expect(result).toEqual({
      net: 189.9,
      fee: 9.47,
      gross: 199.37,
      currency_id: "USD",
    });
    expect(result.referenceUsd).toBeUndefined();
  });

  test("vendedor fuera de Colombia pero sitio en COP también cobra en COP", () => {
    // characterization: current behaviour, see report — `siteCurrency === "COP"`
    // fuerza COP incluso para un vendedor no colombiano; sólo depende del
    // env MERCADOPAGO_CURRENCY, no de MERCADOPAGO_SELLER_COUNTRY, en esta rama.
    process.env.MERCADOPAGO_SELLER_COUNTRY = "MX";
    process.env.MERCADOPAGO_CURRENCY = "COP";

    const result = mercadoPagoItemAmount(basePlan);
    expect(result.currency_id).toBe("COP");
  });
});

describe("mercadoPagoItemAmount — boundary de precios", () => {
  test("amountCop = 1 (mínimo positivo) se acepta y hace gross-up igual", () => {
    process.env.MERCADOPAGO_SELLER_COUNTRY = "CO";
    process.env.MERCADOPAGO_CURRENCY = "COP";
    const plan: Plan = { ...basePlan, amountCop: 1 };
    const result = mercadoPagoItemAmount(plan);
    expect(result).toEqual({ net: 1, fee: 0, gross: 1, currency_id: "COP" });
  });
});
