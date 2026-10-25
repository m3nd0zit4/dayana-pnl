import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { CUSTOM_PLAN_ID_PREFIX, isPromoExcludedProduct } from "../pricing/promo-exclusions";
import { encodeCheckoutReference, parseCheckoutReference } from "./checkout-reference";
import {
  CUSTOM_AMOUNT_LIMITS,
  CUSTOM_PAYMENT_PRODUCT_ID,
  CUSTOM_PLAN_PREFIX,
  cleanCustomConcept,
  customAmountToMinor,
  customPlanFromTerms,
  customPlanIdFor,
  customTermsFromLink,
  formatCustomAmount,
  isCustomPlanId,
  parseCustomPlanId,
  parseTypedAmount,
  providerForCurrency,
} from "./custom-payment-rules";

const LINK_ID = "cmabc123def456ghi789jkl012";

describe("id de plan de un enlace libre", () => {
  test("ida y vuelta", () => {
    const planId = customPlanIdFor(LINK_ID);
    expect(planId).toBe(`enlace-${LINK_ID}`);
    expect(parseCustomPlanId(planId)).toBe(LINK_ID);
    expect(isCustomPlanId(planId)).toBe(true);
  });

  test("lo que no es un enlace no se lee como uno", () => {
    for (const id of [
      "therapy-6",
      "course-live",
      "taller-sanacion",
      // El producto oculto jamás debe leerse como un enlace.
      CUSTOM_PAYMENT_PRODUCT_ID,
      "enlace-",
      "enlace-corto",
      "enlace-MAYUSCULAS12345",
      "enlace-con-guiones-12345",
      `enlace-${"a".repeat(41)}`,
    ]) {
      expect(parseCustomPlanId(id)).toBeNull();
      expect(isCustomPlanId(id)).toBe(false);
    }
    expect(isCustomPlanId(null)).toBe(false);
    expect(isCustomPlanId(undefined)).toBe(false);
  });

  test("el id es un id de plan válido para las rutas de pago", () => {
    // Mismo patrón que `isPlanId` en lib/plans.ts.
    expect(/^[a-z0-9][a-z0-9-]*$/.test(customPlanIdFor(LINK_ID))).toBe(true);
  });

  test("sobrevive a la referencia firmada del checkout y cabe en custom_id de PayPal", () => {
    process.env.AUTH_SECRET = "test-secret-for-custom-payment";
    const ref = encodeCheckoutReference("cjk1234567890abcdefghijkl", customPlanIdFor(LINK_ID));
    expect(ref.length).toBeLessThanOrEqual(127);
    const parsed = parseCheckoutReference(ref);
    expect(parsed?.planId).toBe(customPlanIdFor(LINK_ID));
    expect(parsed?.signed).toBe(true);
  });
});

describe("exclusión de promos", () => {
  test("las dos copias del prefijo coinciden", () => {
    // `promo-exclusions.ts` no tiene dependencias a propósito y repite el
    // prefijo; si divergieran, un cupón sin productos alcanzaría los montos libres.
    expect(CUSTOM_PLAN_ID_PREFIX).toBe(CUSTOM_PLAN_PREFIX);
  });

  test("un plan libre nunca admite código promocional", () => {
    expect(isPromoExcludedProduct(customPlanIdFor(LINK_ID))).toBe(true);
    expect(isPromoExcludedProduct("therapy-6")).toBe(false);
    expect(isPromoExcludedProduct("course-live")).toBe(true);
  });
});

describe("customAmountToMinor", () => {
  test("USD: dólares a centavos, hasta dos decimales", () => {
    expect(customAmountToMinor(250, "USD")).toEqual({ ok: true, currency: "USD", amountMinor: 25000 });
    expect(customAmountToMinor(250.5, "USD")).toEqual({ ok: true, currency: "USD", amountMinor: 25050 });
    // 19.99 * 100 = 1998.9999999999998 en coma flotante: no puede perder un centavo.
    expect(customAmountToMinor(19.99, "USD")).toEqual({ ok: true, currency: "USD", amountMinor: 1999 });
    // El ruido de coma flotante (100.30000000000001) no es un tercer decimal:
    // son 10.030 centavos exactos.
    expect(customAmountToMinor(0.1 + 0.2 + 100, "USD")).toEqual({
      ok: true,
      currency: "USD",
      amountMinor: 10030,
    });
  });

  test("USD: tres decimales se rechazan, no se redondean", () => {
    expect(customAmountToMinor(250.505, "USD")).toEqual({ ok: false, error: "invalid_amount" });
  });

  test("COP: pesos enteros", () => {
    expect(customAmountToMinor(500000, "COP")).toEqual({ ok: true, currency: "COP", amountMinor: 500000 });
    expect(customAmountToMinor(500000.5, "COP")).toEqual({ ok: false, error: "invalid_amount" });
  });

  test("moneda desconocida o vacía", () => {
    expect(customAmountToMinor(10, "EUR")).toEqual({ ok: false, error: "invalid_currency" });
    expect(customAmountToMinor(10, undefined)).toEqual({ ok: false, error: "invalid_currency" });
    expect(customAmountToMinor(10, "usd")).toEqual({ ok: false, error: "invalid_currency" });
  });

  test("lo que no es un número positivo y finito", () => {
    for (const bad of [0, -5, NaN, Infinity, "250", null, undefined, {}]) {
      expect(customAmountToMinor(bad, "USD")).toEqual({ ok: false, error: "invalid_amount" });
    }
  });

  test("suelo y tope por moneda (la red contra un cero de más)", () => {
    expect(customAmountToMinor(0.5, "USD")).toEqual({ ok: false, error: "amount_too_small" });
    expect(customAmountToMinor(1, "USD").ok).toBe(true);
    expect(customAmountToMinor(10_000, "USD").ok).toBe(true);
    expect(customAmountToMinor(10_000.01, "USD")).toEqual({ ok: false, error: "amount_too_large" });
    expect(customAmountToMinor(4_999, "COP")).toEqual({ ok: false, error: "amount_too_small" });
    expect(customAmountToMinor(CUSTOM_AMOUNT_LIMITS.COP.max, "COP").ok).toBe(true);
    expect(customAmountToMinor(CUSTOM_AMOUNT_LIMITS.COP.max + 1, "COP")).toEqual({
      ok: false,
      error: "amount_too_large",
    });
  });
});

describe("parseTypedAmount", () => {
  test("COP: el punto y la coma son miles, nunca decimales", () => {
    expect(parseTypedAmount("500.000", "COP")).toBe(500000);
    expect(parseTypedAmount("500,000", "COP")).toBe(500000);
    expect(parseTypedAmount("1.250.000", "COP")).toBe(1250000);
    expect(parseTypedAmount("1,250,000", "COP")).toBe(1250000);
    expect(parseTypedAmount("500000", "COP")).toBe(500000);
    expect(parseTypedAmount(" $ 500.000 ", "COP")).toBe(500000);
  });

  test("COP: lo ambiguo se rechaza en vez de leerse mal", () => {
    // «500.5» no es un monto en pesos; leerlo como 5005 cobraría diez veces más.
    expect(parseTypedAmount("500.5", "COP")).toBeNull();
    expect(parseTypedAmount("500.50", "COP")).toBeNull();
    expect(parseTypedAmount("1.2500", "COP")).toBeNull();
    expect(parseTypedAmount("12.34.567", "COP")).toBeNull();
    expect(parseTypedAmount("abc", "COP")).toBeNull();
    expect(parseTypedAmount("", "COP")).toBeNull();
  });

  test("USD: decimales con punto o coma, y coma de miles", () => {
    expect(parseTypedAmount("250", "USD")).toBe(250);
    expect(parseTypedAmount("250.50", "USD")).toBe(250.5);
    expect(parseTypedAmount("250,50", "USD")).toBe(250.5);
    expect(parseTypedAmount("1,250.50", "USD")).toBe(1250.5);
    expect(parseTypedAmount("$250.5", "USD")).toBe(250.5);
  });

  test("USD: «1.250» es ambiguo (mil doscientos cincuenta en español) y se rechaza", () => {
    expect(parseTypedAmount("1.250", "USD")).toBeNull();
    expect(parseTypedAmount("250.505", "USD")).toBeNull();
    expect(parseTypedAmount("1.250.000", "USD")).toBeNull();
    expect(parseTypedAmount("dos", "USD")).toBeNull();
  });
});

describe("plan de un enlace libre", () => {
  const usd = { linkId: LINK_ID, amountMinor: 25050, currency: "USD" as const, concept: "Diferencia del paquete" };
  const cop = { linkId: LINK_ID, amountMinor: 500000, currency: "COP" as const, concept: "Abono" };

  test("USD: solo se rellena el precio en dólares", () => {
    const plan = customPlanFromTerms(usd);
    expect(plan.id).toBe(customPlanIdFor(LINK_ID));
    expect(plan.title).toBe("Diferencia del paquete");
    expect(plan.amountUsd).toBe(250.5);
    expect(plan.amountCop).toBeUndefined();
    expect(plan.recurring).toBeUndefined();
  });

  test("COP: solo se rellena el precio en pesos (nunca se deriva de USD)", () => {
    const plan = customPlanFromTerms(cop);
    expect(plan.amountCop).toBe(500000);
    expect(plan.amountUsd).toBe(0);
  });

  test("el riel lo decide la moneda", () => {
    expect(providerForCurrency("USD")).toBe("paypal");
    expect(providerForCurrency("COP")).toBe("mercadopago");
  });

  test("customTermsFromLink exige los tres campos", () => {
    const full = {
      id: LINK_ID,
      customAmountMinor: 25050,
      customCurrency: "USD",
      customConcept: " Abono ",
    };
    expect(customTermsFromLink(full)).toEqual({
      linkId: LINK_ID,
      amountMinor: 25050,
      currency: "USD",
      concept: "Abono",
    });
    expect(customTermsFromLink({ ...full, customAmountMinor: null })).toBeNull();
    expect(customTermsFromLink({ ...full, customAmountMinor: 0 })).toBeNull();
    expect(customTermsFromLink({ ...full, customCurrency: null })).toBeNull();
    expect(customTermsFromLink({ ...full, customCurrency: "EUR" })).toBeNull();
    expect(customTermsFromLink({ ...full, customConcept: "  " })).toBeNull();
    expect(customTermsFromLink({ ...full, customConcept: null })).toBeNull();
  });
});

describe("textos", () => {
  test("formatCustomAmount conserva los centavos que formatUsd redondea", () => {
    expect(formatCustomAmount(25050, "USD")).toBe("$250.50 USD");
    expect(formatCustomAmount(25000, "USD")).toBe("$250.00 USD");
    expect(formatCustomAmount(500000, "COP")).toContain("500.000");
    expect(formatCustomAmount(500000, "COP")).toEndWith("COP");
  });

  test("cleanCustomConcept", () => {
    expect(cleanCustomConcept("  Diferencia   del\npaquete ")).toBe("Diferencia del paquete");
    expect(cleanCustomConcept("   ")).toBeNull();
    expect(cleanCustomConcept("a".repeat(141))).toBeNull();
    expect(cleanCustomConcept("a".repeat(140))).not.toBeNull();
    expect(cleanCustomConcept(42)).toBeNull();
  });
});

let savedAuthSecret: string | undefined;
beforeEach(() => {
  savedAuthSecret = process.env.AUTH_SECRET;
});
afterEach(() => {
  if (savedAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = savedAuthSecret;
});
