import { describe, expect, test } from "bun:test";

import {
  PROMO_EXCLUDED_PRODUCT_IDS,
  isPromoExcludedProduct,
} from "./promo-exclusions";

describe("isPromoExcludedProduct", () => {
  test("el producto de la lista de exclusión (course-live) nunca acepta promo", () => {
    expect(PROMO_EXCLUDED_PRODUCT_IDS).toEqual(["course-live"]);
    expect(isPromoExcludedProduct("course-live")).toBe(true);
  });

  test("cualquier otro producto sí puede llevar promo", () => {
    expect(isPromoExcludedProduct("therapy-6")).toBe(false);
    expect(isPromoExcludedProduct("membership-monthly")).toBe(false);
  });

  test("null y undefined no son 'excluidos' (false, no true)", () => {
    expect(isPromoExcludedProduct(null)).toBe(false);
    expect(isPromoExcludedProduct(undefined)).toBe(false);
  });

  test("productId vacío ('') no está en la lista, así que no se excluye", () => {
    expect(isPromoExcludedProduct("")).toBe(false);
  });
});
