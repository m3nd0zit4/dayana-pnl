import { describe, expect, test, afterEach } from "bun:test";

import {
  grossUpInt,
  grossUpUsd,
  mercadoPagoFee,
  paypalFee,
  type FeeConfig,
} from "./fees";

const PAYPAL_ENV_KEYS = ["PAYPAL_FEE_PERCENT", "PAYPAL_FEE_FIXED"] as const;
const MP_ENV_KEYS = [
  "MERCADOPAGO_FEE_PERCENT",
  "MERCADOPAGO_FEE_FIXED",
] as const;

const savedEnv = new Map<string, string | undefined>();
const stashEnv = (key: string) => {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
};

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

describe("paypalFee / mercadoPagoFee defaults", () => {
  test("paypalFee usa 5.4% + USD 0.30 sin env", () => {
    for (const k of PAYPAL_ENV_KEYS) {
      stashEnv(k);
      delete process.env[k];
    }
    expect(paypalFee()).toEqual({ percent: 0.054, fixed: 0.3 });
  });

  test("mercadoPagoFee usa 4.75% sin componente fijo sin env", () => {
    for (const k of MP_ENV_KEYS) {
      stashEnv(k);
      delete process.env[k];
    }
    expect(mercadoPagoFee()).toEqual({ percent: 0.0475, fixed: 0 });
  });

  test("env vacío ('') cae al fallback, igual que ausente", () => {
    stashEnv("PAYPAL_FEE_PERCENT");
    process.env.PAYPAL_FEE_PERCENT = "";
    expect(paypalFee().percent).toBe(0.054);
  });

  // characterization: current behaviour, see report — un valor negativo en
  // env también cae al fallback (num() exige >= 0), pero uno no numérico
  // ("abc") también cae al fallback porque Number("abc") es NaN.
  test("env negativo o no numérico cae al fallback", () => {
    stashEnv("PAYPAL_FEE_PERCENT");
    process.env.PAYPAL_FEE_PERCENT = "-0.1";
    expect(paypalFee().percent).toBe(0.054);
    process.env.PAYPAL_FEE_PERCENT = "abc";
    expect(paypalFee().percent).toBe(0.054);
  });

  test("env válido se respeta", () => {
    stashEnv("MERCADOPAGO_FEE_PERCENT");
    stashEnv("MERCADOPAGO_FEE_FIXED");
    process.env.MERCADOPAGO_FEE_PERCENT = "0.1";
    process.env.MERCADOPAGO_FEE_FIXED = "500";
    expect(mercadoPagoFee()).toEqual({ percent: 0.1, fixed: 500 });
  });
});

describe("grossUpUsd (USD, 2 decimales)", () => {
  const paypal: FeeConfig = { percent: 0.054, fixed: 0.3 };

  test("net <= 0 devuelve todo en cero (incluye negativos y NaN)", () => {
    expect(grossUpUsd(0, paypal)).toEqual({ net: 0, fee: 0, gross: 0 });
    expect(grossUpUsd(-5, paypal)).toEqual({ net: 0, fee: 0, gross: 0 });
    expect(grossUpUsd(NaN, paypal)).toEqual({ net: 0, fee: 0, gross: 0 });
  });

  test("sin comisión (percent y fixed en 0) sólo redondea a 2 decimales", () => {
    expect(grossUpUsd(10, { percent: 0, fixed: 0 })).toEqual({
      net: 10,
      fee: 0,
      gross: 10,
    });
  });

  test("boundary: net = 1 centavo (0.01 USD)", () => {
    // characterization: current behaviour, see report — la comisión fija de
    // 0.30 domina en montos minúsculos: cobrar 1 centavo neto exige un bruto
    // de 0.33 USD, 33x el neto.
    expect(grossUpUsd(0.01, paypal)).toEqual({ net: 0.01, fee: 0.32, gross: 0.33 });
  });

  test("boundary: net = 1 USD", () => {
    expect(grossUpUsd(1, paypal)).toEqual({ net: 1, fee: 0.37, gross: 1.37 });
  });

  test("precio típico de plan: net = 9.99 USD", () => {
    expect(grossUpUsd(9.99, paypal)).toEqual({
      net: 9.99,
      fee: 0.89,
      gross: 10.88,
    });
  });

  test("precio típico de plan: net = 29 USD", () => {
    expect(grossUpUsd(29, paypal)).toEqual({ net: 29, fee: 1.97, gross: 30.97 });
  });

  test("precio típico de plan: net = 97 USD", () => {
    expect(grossUpUsd(97, paypal)).toEqual({ net: 97, fee: 5.85, gross: 102.85 });
  });

  test("boundary: net grande (100000 USD)", () => {
    expect(grossUpUsd(100000, paypal)).toEqual({
      net: 100000,
      fee: 5708.56,
      gross: 105708.56,
    });
  });

  test("invariante: gross - fee === net (después de redondear)", () => {
    for (const net of [0.01, 1, 9.99, 29, 97, 4999.99]) {
      const b = grossUpUsd(net, paypal);
      expect(Math.round((b.gross - b.fee) * 100) / 100).toBe(b.net);
    }
  });
});

describe("grossUpInt (COP, enteros)", () => {
  const mp: FeeConfig = { percent: 0.0475, fixed: 0 };

  test("net <= 0 devuelve todo en cero", () => {
    expect(grossUpInt(0, mp)).toEqual({ net: 0, fee: 0, gross: 0 });
    expect(grossUpInt(-5, mp)).toEqual({ net: 0, fee: 0, gross: 0 });
    expect(grossUpInt(NaN, mp)).toEqual({ net: 0, fee: 0, gross: 0 });
  });

  test("sin comisión sólo redondea a entero", () => {
    expect(grossUpInt(250, { percent: 0, fixed: 0 })).toEqual({
      net: 250,
      fee: 0,
      gross: 250,
    });
  });

  test("boundary: net = 1 peso", () => {
    // characterization: current behaviour, see report — 1 peso de comisión al
    // 4.75% redondea a 0: el bruto cobrado es igual al neto exacto (fee = 0),
    // así que en montos ínfimos Mercado Pago "no cobra" comisión por redondeo.
    expect(grossUpInt(1, mp)).toEqual({ net: 1, fee: 0, gross: 1 });
  });

  test("boundary: net = 100 pesos", () => {
    expect(grossUpInt(100, mp)).toEqual({ net: 100, fee: 5, gross: 105 });
  });

  test("precio típico de plan: net = 39900 COP", () => {
    expect(grossUpInt(39900, mp)).toEqual({ net: 39900, fee: 1990, gross: 41890 });
  });

  test("precio típico de plan: net = 189900 COP", () => {
    expect(grossUpInt(189900, mp)).toEqual({
      net: 189900,
      fee: 9470,
      gross: 199370,
    });
  });

  test("boundary: net grande (100,000,000 COP)", () => {
    expect(grossUpInt(100000000, mp)).toEqual({
      net: 100000000,
      fee: 4986877,
      gross: 104986877,
    });
  });

  test("boundary: net no entero con comisión activa redondea net Y gross por separado", () => {
    // characterization: current behaviour, see report — grossUpInt no exige
    // que `net` sea entero. Con net=1.5 y comisión > 0, `net` se redondea
    // (Math.round(1.5) = 2) y `gross` se calcula y redondea aparte
    // (Math.round(1.5/(1-0.0475)) = Math.round(1.5748..) = 2), así que aquí
    // ambos coinciden en 2 y `fee` sale en 0 aunque la comisión sea > 0 — un
    // artefacto de redondeo en montos fraccionarios de COP, moneda que en la
    // práctica nunca debería recibir decimales.
    expect(grossUpInt(1.5, mp)).toEqual({ net: 2, fee: 0, gross: 2 });
  });

  test("invariante: gross - fee === net", () => {
    for (const net of [1, 100, 39900, 189900, 5_000_000]) {
      const b = grossUpInt(net, mp);
      expect(b.gross - b.fee).toBe(b.net);
    }
  });
});
