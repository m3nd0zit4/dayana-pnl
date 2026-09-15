import { describe, expect, test } from "bun:test";

import { enrollmentStatusPluralLabel } from "./enrollment-labels";
import {
  PAYMENT_PROVIDER_LONG_LABEL,
  PAYMENT_STATUS_LABEL,
  paymentProviderLabel,
  paymentProviderLongLabel,
  subscriptionStatusLabel,
} from "./payment-labels";

describe("etiquetas de proveedor", () => {
  test("corta con fallback al valor crudo", () => {
    expect(paymentProviderLabel("PAYPAL")).toBe("PayPal");
    expect(paymentProviderLabel("MERCADO_PAGO")).toBe("Mercado Pago");
    expect(paymentProviderLabel("MANUAL")).toBe("Manual");
    expect(paymentProviderLabel("STRIPE")).toBe("STRIPE");
  });

  test("larga sólo cambia el registro manual", () => {
    expect(PAYMENT_PROVIDER_LONG_LABEL.MANUAL).toBe("Registro manual");
    expect(paymentProviderLongLabel("PAYPAL")).toBe("PayPal");
    expect(paymentProviderLongLabel("OTRO")).toBe("OTRO");
  });
});

describe("etiquetas de estado", () => {
  test("pago", () => {
    expect(PAYMENT_STATUS_LABEL.APPROVED).toBe("Aprobado");
    expect(PAYMENT_STATUS_LABEL.FAILED).toBe("Fallido");
  });

  test("suscripción con fallback al valor crudo", () => {
    expect(subscriptionStatusLabel("ACTIVE")).toBe("Activa");
    expect(subscriptionStatusLabel("SUSPENDED")).toBe("Suspendida");
    expect(subscriptionStatusLabel("CANCELLED")).toBe("Cancelada");
    expect(subscriptionStatusLabel("EXPIRED")).toBe("Vencida");
    expect(subscriptionStatusLabel("ALGO_NUEVO")).toBe("ALGO_NUEVO");
  });

  test("inscripción en plural", () => {
    expect(enrollmentStatusPluralLabel("LEAD")).toBe("Leads");
    expect(enrollmentStatusPluralLabel("ACTIVE")).toBe("Activos");
    expect(enrollmentStatusPluralLabel("REFUNDED")).toBe("Reembolsados");
    expect(enrollmentStatusPluralLabel("OTRO")).toBe("OTRO");
  });
});
