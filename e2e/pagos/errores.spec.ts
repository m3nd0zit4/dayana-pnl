// Antes que nada: engancha el alias `@/` para los import() diferidos.
import "./alias";

import { test, expect } from "@playwright/test";
import {
  mapMercadoPagoStatus,
  parsePayPalError,
  PayPalApiError,
} from "../../lib/payments/errors";

/**
 * Que un pago rechazado se diga rechazado.
 *
 * El caso que esto fija: una clienta pagó, PayPal devolvió 422 porque su banco
 * rechazó la tarjeta, y la pantalla final le dijo «se está procesando tu pago».
 * Se quedó esperando un acceso que no iba a llegar, y el motivo real sólo se
 * supo llamando por teléfono a PayPal.
 *
 * Lo que se prueba aquí es la clasificación, que es de donde cuelga todo lo
 * demás: qué pantalla ve la clienta, si se registra el intento, y qué se le
 * dice al equipo.
 */

test.describe("PayPal · clasificación de errores", () => {
  test("el banco rechaza la tarjeta: es un rechazo, no un 'procesando'", () => {
    const failure = parsePayPalError(422, {
      name: "UNPROCESSABLE_ENTITY",
      debug_id: "abc123",
      details: [{ issue: "INSTRUMENT_DECLINED" }],
    });

    expect(failure.outcome).toBe("rejected");
    expect(failure.code).toBe("INSTRUMENT_DECLINED");
    // Lo que la clienta necesita saber: fue su banco, y qué hacer ahora.
    expect(failure.buyerMessage).toContain("banco");
    // Y lo que el equipo necesita para reclamar sin llamar por teléfono.
    expect(failure.staffMessage).toContain("abc123");
    expect(failure.debugId).toBe("abc123");
  });

  test("una orden ya capturada NO es un fallo", () => {
    const failure = parsePayPalError(422, {
      details: [{ issue: "ORDER_ALREADY_CAPTURED" }],
    });

    // Decirle «no se pudo completar» a alguien a quien SÍ se le cobró es el
    // peor mensaje posible.
    expect(failure.outcome).toBe("succeeded");
    expect(failure.retryable).toBe(false);
  });

  test("PayPal caído es pendiente, no rechazo", () => {
    const failure = parsePayPalError(503, {});
    expect(failure.outcome).toBe("pending");
    expect(failure.retryable).toBe(true);
  });

  test("un código que no conocemos nunca se declara rechazo", () => {
    const failure = parsePayPalError(422, {
      details: [{ issue: "ALGO_QUE_NO_EXISTE_TODAVIA" }],
    });

    expect(failure.outcome).toBe("unknown");
    expect(failure.rawCode).toBe("ALGO_QUE_NO_EXISTE_TODAVIA");
  });

  test("3-D Secure fallido se distingue del rechazo del banco", () => {
    const failure = parsePayPalError(422, {
      details: [{ issue: "CONTINGENCY_NOT_SUCCESSFUL" }],
    });
    expect(failure.outcome).toBe("rejected");
    expect(failure.retryable).toBe(true);
  });

  test("el error conserva la respuesta en vez de aplastarla en texto", () => {
    const error = new PayPalApiError("capture", 422, {
      debug_id: "xyz789",
      details: [{ issue: "INSTRUMENT_DECLINED" }],
    });

    expect(error.status).toBe(422);
    expect(error.failure.code).toBe("INSTRUMENT_DECLINED");
    expect(error.failure.debugId).toBe("xyz789");
  });
});

test.describe("Mercado Pago · clasificación de errores", () => {
  test("cada motivo de rechazo dice algo distinto", () => {
    const saldo = mapMercadoPagoStatus(
      "cc_rejected_insufficient_amount",
      "rejected"
    );
    const cvv = mapMercadoPagoStatus(
      "cc_rejected_bad_filled_security_code",
      "rejected"
    );

    expect(saldo.outcome).toBe("rejected");
    expect(cvv.outcome).toBe("rejected");
    // Lo que antes no pasaba: los dos daban el mismo mensaje vacío.
    expect(saldo.buyerMessage).not.toBe(cvv.buyerMessage);
    expect(saldo.buyerMessage).toContain("saldo");
    expect(cvv.buyerMessage).toContain("código de seguridad");
  });

  test("un PSE esperando pago NO es un fallo", () => {
    const failure = mapMercadoPagoStatus("pending_waiting_payment", "pending");

    // Decirle «tu pago falló» a quien va camino del banco a pagarlo sería
    // exactamente el error contrario al que se está arreglando.
    expect(failure.outcome).toBe("pending");
    expect(failure.retryable).toBe(false);
  });

  test("una transferencia en curso tampoco", () => {
    expect(mapMercadoPagoStatus("pending_waiting_transfer", "pending").outcome).toBe(
      "pending"
    );
  });

  test("un pago duplicado significa que ya se cobró", () => {
    const failure = mapMercadoPagoStatus(
      "cc_rejected_duplicated_payment",
      "rejected"
    );
    expect(failure.outcome).toBe("succeeded");
  });

  test("un status_detail nuevo se clasifica por el status", () => {
    // MP añade códigos con el tiempo; uno desconocido con `rejected` sigue
    // siendo un rechazo, no un «no sabemos».
    const failure = mapMercadoPagoStatus("cc_rejected_algo_nuevo", "rejected");
    expect(failure.outcome).toBe("rejected");
    expect(failure.rawCode).toBe("cc_rejected_algo_nuevo");
  });

  test("sin detalle ni status no se inventa un rechazo", () => {
    expect(mapMercadoPagoStatus(null, null).outcome).toBe("unknown");
  });
});

test.describe("Los dos mensajes", () => {
  test("el de la clienta no lleva jerga; el del equipo sí lleva el código", () => {
    const failure = parsePayPalError(422, {
      debug_id: "d-1",
      details: [{ issue: "INSTRUMENT_DECLINED" }],
    });

    // La clienta no tiene por qué leer el nombre interno del error.
    expect(failure.buyerMessage).not.toContain("INSTRUMENT_DECLINED");
    expect(failure.staffMessage).toContain("INSTRUMENT_DECLINED");
  });
});
