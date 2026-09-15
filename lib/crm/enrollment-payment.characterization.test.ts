import { describe, expect, test } from "bun:test";

import {
  EnrollmentPaymentError,
  assertPayPalCaptureAmount,
  enrollmentPaymentErrorStatus,
} from "./enrollment-payment";

// Sólo se ejercitan las funciones puras de este módulo. `assertEnrollmentPayable`
// habla con Prisma y no se toca aquí (ver reporte: sin cobertura, entrelazado
// con la base de datos).

describe("assertPayPalCaptureAmount", () => {
  test("monto exacto en USD no lanza", () => {
    expect(() =>
      assertPayPalCaptureAmount(10250, "USD", 102.5)
    ).not.toThrow();
  });

  test("moneda distinta de USD siempre lanza PLAN_MISMATCH, incluso si el monto es correcto", () => {
    expect(() => assertPayPalCaptureAmount(10250, "COP", 102.5)).toThrow(
      EnrollmentPaymentError
    );
    try {
      assertPayPalCaptureAmount(10250, "COP", 102.5);
      throw new Error("no debió llegar aquí");
    } catch (e) {
      expect(e).toBeInstanceOf(EnrollmentPaymentError);
      expect((e as EnrollmentPaymentError).code).toBe("PLAN_MISMATCH");
    }
  });

  test("la comparación de moneda ignora mayúsculas/minúsculas ('usd' pasa)", () => {
    expect(() =>
      assertPayPalCaptureAmount(10250, "usd", 102.5)
    ).not.toThrow();
  });

  test("monto distinto en 1 centavo lanza PLAN_MISMATCH", () => {
    expect(() => assertPayPalCaptureAmount(10251, "USD", 102.5)).toThrow(
      "Capture amount does not match plan price"
    );
    expect(() => assertPayPalCaptureAmount(10249, "USD", 102.5)).toThrow(
      "Capture amount does not match plan price"
    );
  });

  test("expectedGrossUsd se redondea a centavos antes de comparar (Math.round(x*100))", () => {
    // characterization: current behaviour, see report — 102.505 * 100 da
    // 10250.5 exacto en este caso, y Math.round redondea "half up" a 10251
    // (no a 10250). El punto de corte real depende de la representación
    // binaria de cada valor concreto, no de una regla decimal simple — otro
    // expectedGrossUsd con .xx5 podría redondear al lado contrario.
    expect(() =>
      assertPayPalCaptureAmount(10251, "USD", 102.505)
    ).not.toThrow();
    expect(() => assertPayPalCaptureAmount(10250, "USD", 102.505)).toThrow();
  });

  test("boundary: monto y esperado en cero coinciden (no lanza)", () => {
    expect(() => assertPayPalCaptureAmount(0, "USD", 0)).not.toThrow();
  });
});

describe("enrollmentPaymentErrorStatus", () => {
  test("NOT_FOUND -> 404", () => {
    expect(enrollmentPaymentErrorStatus("NOT_FOUND")).toBe(404);
  });

  test("INVALID_STATUS, PLAN_MISMATCH, ALREADY_PAID -> 409", () => {
    expect(enrollmentPaymentErrorStatus("INVALID_STATUS")).toBe(409);
    expect(enrollmentPaymentErrorStatus("PLAN_MISMATCH")).toBe(409);
    expect(enrollmentPaymentErrorStatus("ALREADY_PAID")).toBe(409);
  });
});

describe("EnrollmentPaymentError", () => {
  test("guarda el code y hereda de Error con el name correcto", () => {
    const err = new EnrollmentPaymentError("boom", "NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("EnrollmentPaymentError");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("boom");
  });
});
