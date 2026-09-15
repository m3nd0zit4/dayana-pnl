import { describe, expect, test } from "bun:test";

import {
  contactCountryKey,
  contactCountryLabel,
  formatWebinarEditionLabel,
  pipelineStatusLabel,
  resolveSubscriptionProvider,
  shapeWorkshopEditions,
  subscriptionProviderLabel,
  subscriptionStatusLabel,
  summarizeMembersSnapshot,
} from "./people-content-helpers";

describe("summarizeMembersSnapshot", () => {
  const now = new Date("2026-09-14T12:00:00Z");

  test("sin paidUntil cuenta como activa", () => {
    const snapshot = summarizeMembersSnapshot([{ paidUntil: null }], now);
    expect(snapshot).toEqual({ active: 1, expiringThisWeek: 0, expired: 0 });
  });

  test("paidUntil futuro fuera de la ventana: activa, no por vencer", () => {
    const farFuture = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const snapshot = summarizeMembersSnapshot([{ paidUntil: farFuture }], now);
    expect(snapshot).toEqual({ active: 1, expiringThisWeek: 0, expired: 0 });
  });

  test("paidUntil dentro de los próximos 7 días: activa y por vencer", () => {
    const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const snapshot = summarizeMembersSnapshot([{ paidUntil: soon }], now);
    expect(snapshot).toEqual({ active: 1, expiringThisWeek: 1, expired: 0 });
  });

  test("paidUntil pasado: vencida, no activa", () => {
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const snapshot = summarizeMembersSnapshot([{ paidUntil: past }], now);
    expect(snapshot).toEqual({ active: 0, expiringThisWeek: 0, expired: 1 });
  });

  test("paidUntil == now: cuenta como activa (límite inclusivo), no vencida", () => {
    const snapshot = summarizeMembersSnapshot([{ paidUntil: now }], now);
    expect(snapshot.active).toBe(1);
    expect(snapshot.expired).toBe(0);
  });

  test("ventana configurable", () => {
    const in10Days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const snapshot = summarizeMembersSnapshot([{ paidUntil: in10Days }], now, 14);
    expect(snapshot.expiringThisWeek).toBe(1);
  });

  test("mezcla de filas se suma correctamente", () => {
    const soon = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const snapshot = summarizeMembersSnapshot(
      [{ paidUntil: null }, { paidUntil: soon }, { paidUntil: past }, { paidUntil: past }],
      now,
    );
    expect(snapshot).toEqual({ active: 2, expiringThisWeek: 1, expired: 2 });
  });
});

describe("etiquetas de país", () => {
  test("sin país cuando iso es null", () => {
    expect(contactCountryLabel(null)).toBe("Sin país");
    expect(contactCountryKey(null)).toBe("__sin-pais__");
  });

  test("país conocido usa formatCountryLabel", () => {
    expect(contactCountryLabel("CO")).toContain("Colombia");
    expect(contactCountryKey("CO")).toBe("CO");
  });

  test("iso desconocido no revienta: se devuelve tal cual", () => {
    expect(contactCountryLabel("ZZ")).toBe("ZZ");
  });
});

describe("etiquetas de suscripción y pipeline", () => {
  test("estados con fallback al valor crudo", () => {
    expect(subscriptionStatusLabel("ACTIVE")).toBe("Activa");
    expect(subscriptionStatusLabel("SUSPENDED")).toBe("Suspendida");
    expect(subscriptionStatusLabel("CANCELLED")).toBe("Cancelada");
    expect(subscriptionStatusLabel("EXPIRED")).toBe("Vencida");
    expect(subscriptionStatusLabel("ALGO_NUEVO")).toBe("ALGO_NUEVO");
  });

  test("proveedores con fallback al valor crudo", () => {
    expect(subscriptionProviderLabel("PAYPAL")).toBe("PayPal");
    expect(subscriptionProviderLabel("MERCADO_PAGO")).toBe("Mercado Pago");
    expect(subscriptionProviderLabel("MANUAL")).toBe("Manual");
    expect(subscriptionProviderLabel("STRIPE")).toBe("STRIPE");
  });

  test("pipeline usa las etiquetas plurales", () => {
    expect(pipelineStatusLabel("LEAD")).toBe("Leads");
    expect(pipelineStatusLabel("ACTIVE")).toBe("Activos");
    expect(pipelineStatusLabel("REFUNDED")).toBe("Reembolsados");
  });
});

describe("resolveSubscriptionProvider", () => {
  test("manda el id de PayPal si está presente", () => {
    expect(
      resolveSubscriptionProvider({
        paypalSubscriptionId: "I-123",
        mercadoPagoPreapprovalId: null,
        subscriptionProvider: "MERCADO_PAGO",
      }),
    ).toBe("PAYPAL");
  });

  test("manda el id de Mercado Pago si no hay de PayPal", () => {
    expect(
      resolveSubscriptionProvider({
        paypalSubscriptionId: null,
        mercadoPagoPreapprovalId: "2c93...",
        subscriptionProvider: null,
      }),
    ).toBe("MERCADO_PAGO");
  });

  test("cae a subscriptionProvider si no hay ningún id", () => {
    expect(
      resolveSubscriptionProvider({
        paypalSubscriptionId: null,
        mercadoPagoPreapprovalId: null,
        subscriptionProvider: "PAYPAL",
      }),
    ).toBe("PAYPAL");
    expect(
      resolveSubscriptionProvider({
        paypalSubscriptionId: null,
        mercadoPagoPreapprovalId: null,
        subscriptionProvider: null,
      }),
    ).toBeNull();
  });
});

describe("shapeWorkshopEditions", () => {
  test("ordena por fecha ascendente y aplica cupo vendido por defecto 0", () => {
    const rows = shapeWorkshopEditions(
      [
        { id: "b", title: "Taller B", startsAt: new Date("2026-10-01T00:00:00Z"), capacity: 20 },
        { id: "a", title: "Taller A", startsAt: new Date("2026-09-01T00:00:00Z"), capacity: null },
      ],
      new Map([["a", 5]]),
    );
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
    expect(rows[0]).toEqual({
      key: "a",
      label: "Taller A",
      startsAt: "2026-09-01T00:00:00.000Z",
      seatsSold: 5,
      capacity: null,
    });
    expect(rows[1].seatsSold).toBe(0);
    expect(rows[1].capacity).toBe(20);
  });
});

describe("formatWebinarEditionLabel", () => {
  test("sin fecha cuando startsAt es null", () => {
    expect(formatWebinarEditionLabel({ startsAt: null }, "America/Bogota")).toBe("sin fecha");
  });

  test("formatea en la zona dada", () => {
    // 04:30 UTC del 9 de agosto es 23:30 del 8 de agosto en Bogotá (UTC-5).
    const label = formatWebinarEditionLabel(
      { startsAt: new Date("2026-08-09T04:30:00Z") },
      "America/Bogota",
    );
    expect(label).toBe("8 de agosto de 2026");
  });
});
