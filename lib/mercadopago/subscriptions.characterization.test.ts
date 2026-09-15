import { describe, expect, test } from "bun:test";

import { planCheckoutUrl } from "./subscriptions";

// Sólo se ejercita `planCheckoutUrl`, la única función pura de este módulo:
// el resto habla por REST con la API de Mercado Pago (ver reporte: sin
// cobertura, red + env MERCADOPAGO_ACCESS_TOKEN).

describe("planCheckoutUrl", () => {
  test("añade external_reference con '?' cuando el init_point no tiene query", () => {
    const url = planCheckoutUrl(
      "https://mp.example.com/checkout/plan-1",
      "chk:contact_1:therapy-6:sig1234"
    );
    expect(url).toBe(
      "https://mp.example.com/checkout/plan-1?external_reference=chk%3Acontact_1%3Atherapy-6%3Asig1234"
    );
  });

  test("añade external_reference con '&' cuando el init_point ya trae query", () => {
    const url = planCheckoutUrl(
      "https://mp.example.com/checkout/plan-1?utm_source=web",
      "chk:contact_1:therapy-6:sig1234"
    );
    expect(url).toBe(
      "https://mp.example.com/checkout/plan-1?utm_source=web&external_reference=chk%3Acontact_1%3Atherapy-6%3Asig1234"
    );
  });

  test("la referencia va codificada con encodeURIComponent (los ':' se escapan)", () => {
    const url = planCheckoutUrl("https://mp.example.com/x", "chk:a:b");
    expect(url).toContain("external_reference=chk%3Aa%3Ab");
    expect(url).not.toContain("external_reference=chk:a:b");
  });

  // characterization: current behaviour, see report — la detección de query
  // existente es un simple `.includes("?")`, así que un '?' que apareciera
  // DENTRO del propio init_point sin ser un separador real de query string
  // (poco probable en una URL bien formada, pero no lo valida) también haría
  // que se use '&' en vez de '?'.
  test("un '?' en cualquier posición del init_point activa el modo '&'", () => {
    const url = planCheckoutUrl("https://mp.example.com/x?", "ref");
    expect(url).toBe("https://mp.example.com/x?&external_reference=ref");
  });
});
