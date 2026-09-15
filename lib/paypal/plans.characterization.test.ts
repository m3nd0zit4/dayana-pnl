import { describe, expect, test } from "bun:test";

import { billingPlanGrossMinor, type PayPalBillingPlan } from "./plans";

// Sólo se ejercita `billingPlanGrossMinor`, la única función pura de este
// módulo. El resto habla por REST con la API de PayPal (ver reporte: sin
// cobertura, red).

describe("billingPlanGrossMinor", () => {
  test("toma el ciclo REGULAR y lo convierte a centavos", () => {
    const plan: PayPalBillingPlan = {
      id: "P-1",
      billing_cycles: [
        {
          tenure_type: "TRIAL",
          pricing_scheme: { fixed_price: { value: "0.00", currency_code: "USD" } },
        },
        {
          tenure_type: "REGULAR",
          pricing_scheme: {
            fixed_price: { value: "30.97", currency_code: "USD" },
          },
        },
      ],
    };
    expect(billingPlanGrossMinor(plan)).toBe(3097);
  });

  test("sin ciclo REGULAR explícito, cae al primer ciclo de la lista", () => {
    const plan: PayPalBillingPlan = {
      id: "P-2",
      billing_cycles: [
        {
          tenure_type: "TRIAL",
          pricing_scheme: {
            fixed_price: { value: "9.99", currency_code: "USD" },
          },
        },
      ],
    };
    expect(billingPlanGrossMinor(plan)).toBe(999);
  });

  test("sin billing_cycles devuelve null", () => {
    expect(billingPlanGrossMinor({ id: "P-3" })).toBeNull();
  });

  test("billing_cycles vacío (array sin elementos) devuelve null", () => {
    expect(billingPlanGrossMinor({ id: "P-4", billing_cycles: [] })).toBeNull();
  });

  test("sin fixed_price.value devuelve null", () => {
    const plan: PayPalBillingPlan = {
      id: "P-5",
      billing_cycles: [{ tenure_type: "REGULAR", pricing_scheme: {} }],
    };
    expect(billingPlanGrossMinor(plan)).toBeNull();
  });

  test("value no numérico devuelve null", () => {
    const plan: PayPalBillingPlan = {
      id: "P-6",
      billing_cycles: [
        {
          tenure_type: "REGULAR",
          pricing_scheme: {
            fixed_price: { value: "no-es-un-numero", currency_code: "USD" },
          },
        },
      ],
    };
    expect(billingPlanGrossMinor(plan)).toBeNull();
  });

  test("boundary: value en '0.00' da 0, no null", () => {
    // characterization: current behaviour, see report — "0.00" es un string
    // truthy, así que pasa el `if (!value) return null` (que sólo filtra
    // undefined/""), y Number("0.00") = 0 es finito: el resultado es 0, no
    // null. Un plan gratis se distingue de un plan sin precio configurado.
    const plan: PayPalBillingPlan = {
      id: "P-7",
      billing_cycles: [
        {
          tenure_type: "REGULAR",
          pricing_scheme: { fixed_price: { value: "0.00", currency_code: "USD" } },
        },
      ],
    };
    expect(billingPlanGrossMinor(plan)).toBe(0);
  });

  test("redondea centavos de punto flotante con Math.round", () => {
    const plan: PayPalBillingPlan = {
      id: "P-8",
      billing_cycles: [
        {
          tenure_type: "REGULAR",
          pricing_scheme: { fixed_price: { value: "10.005", currency_code: "USD" } },
        },
      ],
    };
    // 10.005 * 100 = 1000.5000000000001 en punto flotante → Math.round = 1001.
    expect(billingPlanGrossMinor(plan)).toBe(1001);
  });
});
