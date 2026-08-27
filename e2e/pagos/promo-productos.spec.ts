// Antes que nada: engancha el alias `@/` para los import() diferidos.
import "./alias";

import { test, expect } from "@playwright/test";
import { db } from "./helpers";
import {
  createPromoCode,
  listAllPromoCodes,
  updatePromoCode,
} from "../../lib/crm/promo-codes-admin";

/**
 * La restricción de productos de un código promocional no se puede perder sola.
 *
 * El fallo que esto fija: `listAllPromoCodes` devolvía la tabla puente sin
 * aplanar (`[{ product: {...} }]`) mientras la página del panel sí la aplanaba
 * al renderizar en el servidor. Resultado: la primera carga se veía bien y
 * CUALQUIER recarga posterior —tras editar o borrar otro código— dejaba la
 * lista entera sin productos. Al abrir uno de esos códigos, el formulario salía
 * con todo desmarcado, y guardar mandaba una lista de `undefined` que el
 * servidor leía como «vale para todos»: un código de 6 sesiones quedaba abierto
 * a todo el catálogo sin que nadie lo pidiera.
 */

const CODE = `E2EPROD${Date.now().toString().slice(-6)}`;
let promoId = "";

test.beforeAll(async () => {
  const promo = await createPromoCode({
    code: CODE,
    discountType: "PERCENT",
    percentOff: 15,
    productIds: ["therapy-6"],
  });
  promoId = promo.id;
});

test.afterAll(async () => {
  await db.promoCode.deleteMany({ where: { code: CODE } });
});

test.describe("Códigos promocionales · la restricción de productos aguanta", () => {
  test("la lista devuelve los productos aplanados, listos para usar", async () => {
    const rows = await listAllPromoCodes();
    const mine = rows.find((p) => p.code === CODE)!;

    expect(mine.products).toHaveLength(1);
    // Lo que rompía: `products[0].id` valía `undefined` porque cada elemento
    // era la fila puente, no el producto.
    expect(mine.products[0].id).toBe("therapy-6");
    expect(mine.products[0].title).toBeTruthy();
  });

  test("editar otro campo no toca la restricción", async () => {
    await updatePromoCode(promoId, { percentOff: 20 });

    const rows = await listAllPromoCodes();
    const mine = rows.find((p) => p.code === CODE)!;
    expect(mine.percentOff).toBe(20);
    expect(mine.products.map((p) => p.id)).toEqual(["therapy-6"]);
  });

  test("una lista con basura se rechaza en vez de vaciar la restricción", async () => {
    await expect(
      updatePromoCode(promoId, {
        productIds: [undefined as unknown as string],
      })
    ).rejects.toThrow("INVALID_PRODUCT_IDS");

    // Lo que importa: sigue restringido.
    const rows = await listAllPromoCodes();
    const mine = rows.find((p) => p.code === CODE)!;
    expect(mine.products.map((p) => p.id)).toEqual(["therapy-6"]);
  });

  test("quitar la restricción a propósito sí funciona", async () => {
    const updated = await updatePromoCode(promoId, { productIds: [] });
    expect(updated.products).toHaveLength(0);

    // Y se puede volver a poner.
    const back = await updatePromoCode(promoId, { productIds: ["therapy-6"] });
    expect(back.products.map((p) => p.id)).toEqual(["therapy-6"]);
  });

  test("cambiar la selección la reemplaza entera, sin duplicar", async () => {
    const updated = await updatePromoCode(promoId, {
      productIds: ["therapy-12"],
    });
    expect(updated.products.map((p) => p.id)).toEqual(["therapy-12"]);

    await updatePromoCode(promoId, { productIds: ["therapy-6"] });
  });

  test("crear con una lista mal formada tampoco cuela", async () => {
    await expect(
      createPromoCode({
        code: `${CODE}X`,
        discountType: "PERCENT",
        percentOff: 10,
        productIds: ["", "therapy-6"],
      })
    ).rejects.toThrow("INVALID_PRODUCT_IDS");

    const orphan = await db.promoCode.findUnique({
      where: { code: `${CODE}X` },
    });
    expect(orphan).toBeNull();
  });
});
