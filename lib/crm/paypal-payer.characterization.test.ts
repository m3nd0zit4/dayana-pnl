import { describe, expect, test } from "bun:test";

import { extractPayPalPayer } from "./paypal-payer";

describe("extractPayPalPayer — payload inválido", () => {
  test("null, undefined y no-objetos devuelven {}", () => {
    expect(extractPayPalPayer(null)).toEqual({});
    expect(extractPayPalPayer(undefined)).toEqual({});
    expect(extractPayPalPayer("string")).toEqual({});
    expect(extractPayPalPayer(42)).toEqual({});
  });

  test("objeto vacío o sin ninguna de las rutas conocidas devuelve {}", () => {
    expect(extractPayPalPayer({})).toEqual({});
    expect(extractPayPalPayer({ something: "else" })).toEqual({});
  });
});

describe("extractPayPalPayer — payment_source.paypal (camino moderno, preferido)", () => {
  test("se usa por encima de payer/captures aunque los tres estén presentes", () => {
    const payload = {
      payment_source: {
        paypal: {
          email_address: "moderno@example.com",
          name: { given_name: "Moderna", surname: "Uno" },
        },
      },
      payer: {
        email_address: "viejo@example.com",
        name: { given_name: "Viejo", surname: "Dos" },
      },
    };
    const result = extractPayPalPayer(payload);
    expect(result.email).toBe("moderno@example.com");
    expect(result.firstName).toBe("Moderna");
  });

  test("extrae email, nombre, teléfono y país", () => {
    const payload = {
      payment_source: {
        paypal: {
          email_address: "  cliente@example.com  ",
          name: { given_name: "Ana", surname: "Pérez" },
          phone: { phone_number: { national_number: "3001234567" } },
          address: { country_code: "co" },
        },
      },
    };
    expect(extractPayPalPayer(payload)).toEqual({
      email: "cliente@example.com",
      firstName: "Ana",
      lastName: "Pérez",
      phone: "3001234567",
      countryIso: "co",
    });
  });

  test("campos ausentes quedan en undefined (no '' ni null) — pero la clave SÍ existe en el objeto", () => {
    // characterization: current behaviour, see report — el objeto se
    // construye con un literal que siempre declara las 5 claves; una que no
    // tiene dato queda en `undefined` explícito, no se omite. `toEqual({})`
    // igual pasa (Bun, como Jest, ignora claves con valor `undefined` al
    // comparar), pero `"email" in result` es `true`: la clave está presente.
    const payload = { payment_source: { paypal: {} } };
    const result = extractPayPalPayer(payload);
    expect(result).toEqual({});
    expect("email" in result).toBe(true);
    expect(result.email).toBeUndefined();
  });

  test("país cae a purchase_units[0].shipping.address si el payer no trae address", () => {
    const payload = {
      payment_source: { paypal: { email_address: "a@b.com" } },
      purchase_units: [{ shipping: { address: { country_code: "MX" } } }],
    };
    expect(extractPayPalPayer(payload).countryIso).toBe("MX");
  });

  test("teléfono sin national_number (o vacío tras trim) queda undefined", () => {
    const payload = {
      payment_source: {
        paypal: { phone: { phone_number: { national_number: "   " } } },
      },
    };
    expect(extractPayPalPayer(payload).phone).toBeUndefined();
  });
});

describe("extractPayPalPayer — payer (deprecado) como fallback", () => {
  test("se usa cuando no hay payment_source.paypal", () => {
    const payload = {
      payer: {
        email_address: "legacy@example.com",
        name: { given_name: "Legado", surname: "Tres" },
      },
    };
    expect(extractPayPalPayer(payload)).toEqual({
      email: "legacy@example.com",
      firstName: "Legado",
      lastName: "Tres",
    });
  });
});

describe("extractPayPalPayer — purchase_units[0].payments.captures[0].payer como último fallback", () => {
  test("se usa cuando no hay payment_source.paypal ni payer", () => {
    const payload = {
      purchase_units: [
        {
          payments: {
            captures: [{ payer: { email_address: "captura@example.com" } }],
          },
        },
      ],
    };
    expect(extractPayPalPayer(payload).email).toBe("captura@example.com");
  });
});

describe("extractPayPalPayer — pago con tarjeta sin cuenta de PayPal (payment_source.card)", () => {
  test("sin ningún payer de wallet, rescata nombre y país de billing_address de la tarjeta", () => {
    const payload = {
      payment_source: {
        card: {
          name: "Maria Fernanda Lopez",
          billing_address: { country_code: "CO" },
        },
      },
    };
    expect(extractPayPalPayer(payload)).toEqual({
      firstName: "Maria",
      lastName: "Fernanda Lopez",
      countryIso: "CO",
    });
  });

  test("nombre de una sola palabra: lastName queda undefined, no ''", () => {
    const payload = {
      payment_source: { card: { name: "Cher" } },
    };
    const result = extractPayPalPayer(payload);
    expect(result.firstName).toBe("Cher");
    expect(result.lastName).toBeUndefined();
  });

  test("sin payer de wallet NI payment_source.card devuelve {}", () => {
    const payload = { payment_source: {} };
    expect(extractPayPalPayer(payload)).toEqual({});
  });
});
