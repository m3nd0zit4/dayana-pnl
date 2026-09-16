import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import crypto from "crypto";

import { verifyMercadoPagoWebhook } from "./verify";

// Sólo se ejercita `verifyMercadoPagoWebhook`: es el único verificador de este
// archivo que protege dinero de verdad (confirma pagos/suscripciones de
// Mercado Pago) y es puro y síncrono. El resto del archivo —Meta, Resend,
// Twilio, Mux, PayPal— no son webhooks de pago (o, en el caso de PayPal,
// necesitan una llamada de red para verificar la firma) y quedan fuera de
// alcance (ver reporte).

const ENV_KEYS = ["MERCADOPAGO_WEBHOOK_SECRET", "NODE_ENV"] as const;

// `process.env.NODE_ENV` es de sólo lectura para TypeScript; en los tests hay
// que escribirlo igualmente para ejercitar el bypass de desarrollo.
const setNodeEnv = (value: string): void => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv.set(k, process.env[k]);
});

afterEach(() => {
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const makeRequest = (headers: Record<string, string>): Request =>
  new Request("http://localhost/api/webhooks/mercadopago", { headers });

/** Reconstruye la firma exactamente como lo hace `verifyMercadoPagoWebhook`. */
const sign = (secret: string, dataId: string, requestId: string, ts: string): string => {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return crypto.createHmac("sha256", secret).update(manifest).digest("hex");
};

describe("verifyMercadoPagoWebhook — sin MERCADOPAGO_WEBHOOK_SECRET configurado", () => {
  test("en desarrollo, pasa igual (bypass local)", () => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    setNodeEnv("development");
    expect(verifyMercadoPagoWebhook(makeRequest({}), "{}")).toBe(true);
  });

  test("fuera de desarrollo, rechaza (no hay forma segura de verificar)", () => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    setNodeEnv("production");
    expect(verifyMercadoPagoWebhook(makeRequest({}), "{}")).toBe(false);
  });
});

describe("verifyMercadoPagoWebhook — con secreto configurado", () => {
  const secret = "test-mp-webhook-secret";

  beforeEach(() => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    setNodeEnv("production");
  });

  test("faltan las cabeceras x-signature/x-request-id: rechaza", () => {
    expect(verifyMercadoPagoWebhook(makeRequest({}), "{}")).toBe(false);
    expect(
      verifyMercadoPagoWebhook(
        makeRequest({ "x-signature": "ts=123,v1=abc" }),
        "{}"
      )
    ).toBe(false);
  });

  test("firma válida con x-data-id explícito: acepta", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = sign(secret, "12345", "req-1", ts);
    const req = makeRequest({
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": "req-1",
      "x-data-id": "12345",
    });
    expect(verifyMercadoPagoWebhook(req, "{}")).toBe(true);
  });

  test("sin x-data-id, cae al 'data.id' del cuerpo JSON crudo", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ data: { id: "98765" } });
    const v1 = sign(secret, "98765", "req-2", ts);
    const req = makeRequest({
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": "req-2",
    });
    expect(verifyMercadoPagoWebhook(req, rawBody)).toBe(true);
  });

  test("sin x-data-id y con cuerpo no parseable como JSON, dataId cae a '' (cadena vacía) y aun así puede validar", () => {
    // characterization: current behaviour, see report — un cuerpo que no es
    // JSON válido no hace fallar la verificación: el dataId simplemente se
    // trata como "" y el manifiesto firmado es `id:;request-id:...;ts:...;`.
    // Si el atacante también controla esa parte del manifiesto podría
    // "firmar" una notificación sin id real, siempre que conozca el secreto
    // — que es justamente lo que la firma existe para impedir, así que en la
    // práctica esto sólo importa si el secreto se filtra.
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = sign(secret, "", "req-3", ts);
    const req = makeRequest({
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": "req-3",
    });
    expect(verifyMercadoPagoWebhook(req, "esto no es json")).toBe(true);
  });

  test("firma alterada en un solo carácter: rechaza", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = sign(secret, "12345", "req-4", ts);
    const tampered = v1.slice(0, -1) + (v1.at(-1) === "0" ? "1" : "0");
    const req = makeRequest({
      "x-signature": `ts=${ts},v1=${tampered}`,
      "x-request-id": "req-4",
      "x-data-id": "12345",
    });
    expect(verifyMercadoPagoWebhook(req, "{}")).toBe(false);
  });

  test("request-id distinto al firmado invalida la firma (viaja fuera de x-signature pero entra al manifiesto)", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = sign(secret, "12345", "req-original", ts);
    const req = makeRequest({
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": "req-suplantado",
      "x-data-id": "12345",
    });
    expect(verifyMercadoPagoWebhook(req, "{}")).toBe(false);
  });

  test("timestamp de más de 5 minutos de antigüedad: rechaza aunque la firma sea válida", () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const v1 = sign(secret, "12345", "req-5", oldTs);
    const req = makeRequest({
      "x-signature": `ts=${oldTs},v1=${v1}`,
      "x-request-id": "req-5",
      "x-data-id": "12345",
    });
    expect(verifyMercadoPagoWebhook(req, "{}")).toBe(false);
  });

  test("timestamp no numérico: rechaza", () => {
    const req = makeRequest({
      "x-signature": "ts=no-es-un-numero,v1=abc123",
      "x-request-id": "req-6",
      "x-data-id": "12345",
    });
    expect(verifyMercadoPagoWebhook(req, "{}")).toBe(false);
  });

  test("boundary: justo por debajo del límite de 5 minutos SÍ pasa", () => {
    // characterization: current behaviour, see report — la comprobación es
    // `Date.now() - tsMs > MAX_AGE_MS` (estrictamente mayor), así que a 299s
    // de antigüedad todavía pasa. No se prueba el límite exacto de 300s
    // porque `ts` trunca a segundos enteros y el propio tiempo de ejecución
    // del test lo haría intermitente.
    const ts = String(Math.floor((Date.now() - 299 * 1000) / 1000));
    const v1 = sign(secret, "12345", "req-7", ts);
    const req = makeRequest({
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": "req-7",
      "x-data-id": "12345",
    });
    expect(verifyMercadoPagoWebhook(req, "{}")).toBe(true);
  });

  test("x-signature con espacios alrededor de 'clave=valor' se parsea igual (trim)", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = sign(secret, "12345", "req-8", ts);
    const req = makeRequest({
      "x-signature": ` ts=${ts} , v1=${v1} `,
      "x-request-id": "req-8",
      "x-data-id": "12345",
    });
    expect(verifyMercadoPagoWebhook(req, "{}")).toBe(true);
  });
});
