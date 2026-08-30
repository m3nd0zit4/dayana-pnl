// Antes que nada: engancha el alias `@/` para los import() diferidos.
import "./alias";

import { test, expect } from "@playwright/test";
import { db } from "./helpers";
import { getPlanFromDb } from "../../lib/plans-from-db";

/**
 * Qué producto se cobra cada mes, y cuál no.
 *
 * El fallo que esto fija: `Plan.kind` sólo distingue terapia de «lo demás», así
 * que un TALLER llegaba al checkout como `"course"`. El modal decidía con
 * `plan.kind === "course"` y acababa ofreciendo «Suscribirme con PayPal» y
 * «Pagar un mes con tarjeta» sobre una compra única — y ese «Suscribirme» ni
 * siquiera podía funcionar, porque el taller no tiene plan recurrente: llevaba
 * a `no_subscription_plan`.
 *
 * Ya había mordido antes: `getPublicPlans` lleva un `p.id !== "workshop-virtual"`
 * puesto a mano para que el taller no se colara como plan del curso.
 *
 * `recurring` responde «¿se cobra cada mes?» y `subscriptionAvailable`
 * «¿existe de verdad el plan en el proveedor?». Son preguntas distintas y el
 * checkout necesita las dos.
 */

test.describe("Plan · recurrencia", () => {
  test("el taller NO es recurrente ni ofrece suscripción", async () => {
    const plan = await getPlanFromDb("workshop-virtual");
    expect(plan, "no existe el producto del taller").not.toBeNull();

    // Sigue siendo "course" — no se cambió el enum, se dejó de usar para esto.
    expect(plan!.kind).toBe("course");

    expect(plan!.recurring, "el taller se paga una vez").toBeFalsy();
    expect(plan!.subscriptionAvailable).toBeFalsy();
  });

  test("una terapia tampoco", async () => {
    const plan = await getPlanFromDb("therapy-6");
    expect(plan).not.toBeNull();
    expect(plan!.recurring).toBeFalsy();
    expect(plan!.subscriptionAvailable).toBeFalsy();
  });

  test("la mensualidad sí es recurrente", async () => {
    const plan = await getPlanFromDb("course-live");
    expect(plan).not.toBeNull();
    expect(plan!.recurring).toBe(true);
  });

  test("sin plan en el proveedor no se ofrece suscribirse", async () => {
    const before = await db.product.findUnique({
      where: { id: "course-live" },
      select: { paypalPlanId: true, mercadoPagoPreapprovalPlanId: true },
    });

    await db.product.update({
      where: { id: "course-live" },
      data: { paypalPlanId: null, mercadoPagoPreapprovalPlanId: null },
    });
    try {
      const plan = await getPlanFromDb("course-live");
      // Sigue siendo mensualidad (los textos dicen «un mes»)…
      expect(plan!.recurring).toBe(true);
      // …pero el botón de suscripción no se puede ofrecer.
      expect(plan!.subscriptionAvailable).toBe(false);
    } finally {
      await db.product.update({
        where: { id: "course-live" },
        data: {
          paypalPlanId: before?.paypalPlanId ?? null,
          mercadoPagoPreapprovalPlanId:
            before?.mercadoPagoPreapprovalPlanId ?? null,
        },
      });
    }
  });

  test("con plan creado, la suscripción vuelve a ofrecerse", async () => {
    const before = await db.product.findUnique({
      where: { id: "course-live" },
      select: { paypalPlanId: true },
    });
    const fake = `P-E2ERECURRENCIA${Date.now().toString().slice(-8)}`;

    await db.product.update({
      where: { id: "course-live" },
      data: { paypalPlanId: fake },
    });
    try {
      const plan = await getPlanFromDb("course-live");
      expect(plan!.subscriptionAvailable).toBe(true);
    } finally {
      await db.product.update({
        where: { id: "course-live" },
        data: { paypalPlanId: before?.paypalPlanId ?? null },
      });
    }
  });
});
