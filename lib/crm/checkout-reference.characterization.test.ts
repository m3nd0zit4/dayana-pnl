import { describe, expect, test, afterEach, beforeEach } from "bun:test";

import {
  encodeCheckoutReference,
  isCheckoutReference,
  parseCheckoutReference,
} from "./checkout-reference";

let savedAuthSecret: string | undefined;

beforeEach(() => {
  savedAuthSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "characterization-test-secret";
});

afterEach(() => {
  if (savedAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = savedAuthSecret;
});

describe("encodeCheckoutReference / parseCheckoutReference roundtrip", () => {
  test("sin promo: contactId + planId, firmado", () => {
    const ref = encodeCheckoutReference("contact_1", "therapy-6");
    expect(ref.startsWith("chk:")).toBe(true);
    expect(isCheckoutReference(ref)).toBe(true);

    const parsed = parseCheckoutReference(ref);
    expect(parsed).toEqual({
      contactId: "contact_1",
      planId: "therapy-6",
      signed: true,
    });
  });

  test("con promo: código y descuento viajan y se recuperan intactos", () => {
    const ref = encodeCheckoutReference("contact_1", "course-live", {
      code: "PROMO10",
      discountMinor: 1500,
    });
    const parsed = parseCheckoutReference(ref);
    expect(parsed).toEqual({
      contactId: "contact_1",
      planId: "course-live",
      promoCode: "PROMO10",
      discountMinor: 1500,
      signed: true,
    });
  });

  test("una referencia manipulada (mismos datos, firma distinta) es rechazada", () => {
    const ref = encodeCheckoutReference("contact_1", "therapy-6");
    const tampered = ref.replace("contact_1", "contact_2");
    expect(parseCheckoutReference(tampered)).toBeNull();
  });

  test("una firma correcta pero con secret distinto al de creación es rechazada", () => {
    const ref = encodeCheckoutReference("contact_1", "therapy-6");
    process.env.AUTH_SECRET = "otro-secret-completamente-distinto";
    expect(parseCheckoutReference(ref)).toBeNull();
  });
});

describe("formato viejo sin firma (compatibilidad hacia atrás)", () => {
  test("2 partes (contactId:planId) sin firma se acepta con signed: false", () => {
    const legacy = "chk:contact_1:therapy-6";
    const parsed = parseCheckoutReference(legacy);
    expect(parsed).toEqual({
      contactId: "contact_1",
      planId: "therapy-6",
      signed: false,
    });
  });

  test("4 partes (con promo) sin firma se acepta con signed: false", () => {
    const legacy = "chk:contact_1:course-live:PROMO10:1500";
    const parsed = parseCheckoutReference(legacy);
    expect(parsed).toEqual({
      contactId: "contact_1",
      planId: "course-live",
      promoCode: "PROMO10",
      discountMinor: 1500,
      signed: false,
    });
  });
});

describe("entradas malformadas", () => {
  test("sin el prefijo 'chk:' devuelve null", () => {
    expect(parseCheckoutReference("contact_1:therapy-6")).toBeNull();
  });

  test("número de partes no reconocido (1 o 6+) devuelve null", () => {
    expect(parseCheckoutReference("chk:solo-una-parte")).toBeNull();
    expect(
      parseCheckoutReference("chk:a:b:c:d:e:f")
    ).toBeNull();
  });

  test("contactId o planId vacío (tras trim) devuelve null", () => {
    expect(parseCheckoutReference("chk::therapy-6")).toBeNull();
    expect(parseCheckoutReference("chk:contact_1:")).toBeNull();
  });

  test("discountMinor no numérico en el cuerpo (formato legado de 4 partes) devuelve null", () => {
    expect(
      parseCheckoutReference("chk:contact_1:course-live:PROMO10:no-es-numero")
    ).toBeNull();
  });

  // characterization: current behaviour, see report — `Number(body[3])` acepta
  // cadena vacía como 0 (Number("") === 0, no NaN), así que un discountMinor
  // vacío en el formato legado de 4 partes PASA la validación con descuento 0,
  // en vez de ser rechazado como "malformado".
  test("discountMinor vacío en formato legado se interpreta silenciosamente como 0", () => {
    const parsed = parseCheckoutReference("chk:contact_1:course-live:PROMO10:");
    expect(parsed).toEqual({
      contactId: "contact_1",
      planId: "course-live",
      promoCode: "PROMO10",
      discountMinor: 0,
      signed: false,
    });
  });
});

describe("isCheckoutReference", () => {
  test("true para una referencia válida, false para cualquier otra cosa", () => {
    const ref = encodeCheckoutReference("contact_1", "therapy-6");
    expect(isCheckoutReference(ref)).toBe(true);
    expect(isCheckoutReference("no-es-una-referencia")).toBe(false);
    expect(isCheckoutReference("")).toBe(false);
  });
});
