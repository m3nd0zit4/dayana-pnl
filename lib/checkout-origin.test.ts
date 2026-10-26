import { describe, expect, test } from "bun:test";

import { CHECKOUT_ORIGIN_KEY, safeCheckoutOrigin } from "./checkout-origin";

describe("safeCheckoutOrigin", () => {
  test("acepta las páginas desde las que se paga", () => {
    for (const path of [
      "/pagar/abc123DEF",
      "/pagar/p/therapy-1",
      "/pagar/terapias",
      "/cursos",
      "/cursos/course-live",
      "/taller-virtual",
      "/taller-virtual/tu-sanacion-con-el-dinero",
      "/terapias/resultado/tok_en-1",
      "/enlaces",
    ]) {
      expect(safeCheckoutOrigin(path)).toBe(path);
    }
  });

  test("quita espacios y acepta la barra final", () => {
    expect(safeCheckoutOrigin("  /cursos/  ")).toBe("/cursos/");
  });

  test("nada vacío ni ausente", () => {
    expect(safeCheckoutOrigin(null)).toBeNull();
    expect(safeCheckoutOrigin(undefined)).toBeNull();
    expect(safeCheckoutOrigin("")).toBeNull();
    expect(safeCheckoutOrigin("   ")).toBeNull();
  });

  test("rechaza lo que no es una página nuestra de compra", () => {
    for (const path of [
      "/",
      "/admin",
      "/admin/payments",
      "/api/paypal/create-order",
      "/pago/exito",
      "/miembros/curso",
      "/pagarx",
      "/cursosx",
    ]) {
      expect(safeCheckoutOrigin(path)).toBeNull();
    }
  });

  test("rechaza URL completas, esquemas, host sin esquema y barras dobles", () => {
    for (const path of [
      "https://evil.example/pagar/x",
      "http://evil.example/cursos",
      "//evil.example/pagar/x",
      "///pagar/x",
      "javascript:alert(1)",
      "pagar/x",
      "\\\\evil.example\\pagar",
      "/\\evil.example",
    ]) {
      expect(safeCheckoutOrigin(path)).toBeNull();
    }
  });

  test("rechaza recorridos con puntos, consultas, fragmentos y caracteres raros", () => {
    for (const path of [
      "/pagar/../admin",
      "/pagar/./x",
      "/cursos/..",
      "/pagar/x?next=//evil.example",
      "/pagar/x#frag",
      "/pagar/x y",
      "/pagar/<script>",
      "/pagar/x\n/admin",
      "/pagar//x",
    ]) {
      expect(safeCheckoutOrigin(path)).toBeNull();
    }
  });

  test("rechaza rutas demasiado largas", () => {
    expect(safeCheckoutOrigin(`/pagar/${"a".repeat(200)}`)).toBeNull();
    expect(safeCheckoutOrigin(`/pagar/${"a".repeat(150)}`)).not.toBeNull();
  });

  test("la clave de almacenamiento es estable", () => {
    expect(CHECKOUT_ORIGIN_KEY).toBe("dayana:checkout-origin");
  });
});
