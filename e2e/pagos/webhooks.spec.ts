import { test, expect } from "@playwright/test";
import {
  createCheckout,
  postPayPalWebhook,
  postMercadoPagoWebhook,
  paymentsFor,
  enrollmentOf,
  contactById,
  nextProviderId,
  testEmail,
  cleanupTestData,
  db,
} from "./helpers";

test.afterAll(async () => {
  await cleanupTestData();
  await db.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("PayPal · webhook", () => {
  test("CHECKOUT.ORDER.COMPLETED registra el pago y matricula", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "paypal", "therapy-1");
    const captureId = nextProviderId("CAP");

    const r = await postPayPalWebhook(baseURL!, {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: chk.checkoutReference!,
      captureId,
      shape: "order",
      payerEmail: testEmail("ana.paypal"),
      payerFirst: "Ana",
      payerLast: "Restrepo",
    });
    expect(r.status).toBe(200);

    const pagos = await paymentsFor(captureId);
    expect(pagos).toHaveLength(1);
    expect(pagos[0].status).toBe("APPROVED");
    expect(pagos[0].provider).toBe("PAYPAL");

    const enr = await enrollmentOf(chk.contactId!, "therapy-1");
    expect(enr?.status).toBe("ACTIVE");
  });

  test("el reenvío del mismo evento no duplica el pago", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "paypal", "therapy-3");
    const captureId = nextProviderId("CAP");
    const payload = {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: chk.checkoutReference!,
      captureId,
      shape: "order" as const,
      payerEmail: testEmail("dup.paypal"),
    };

    await postPayPalWebhook(baseURL!, payload);
    await postPayPalWebhook(baseURL!, payload);

    expect(await paymentsFor(captureId)).toHaveLength(1);
  });

  test("los datos del pagador completan el contacto temporal", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "paypal", "therapy-6");
    const email = testEmail("datos.paypal");

    await postPayPalWebhook(baseURL!, {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: chk.checkoutReference!,
      captureId: nextProviderId("CAP"),
      shape: "order",
      payerEmail: email,
      payerFirst: "Camila",
      payerLast: "Gómez",
    });

    const contact = await contactById(chk.contactId!);
    expect(contact?.email).toBe(email);
    expect(contact?.firstName).toBe("Camila");
    // El teléfono sigue temporal: es el dato que ningún proveedor entrega y
    // por el que /pago/exito pide el WhatsApp.
    expect(contact?.phoneE164).toMatch(/^\+pending:/);
  });

  /**
   * La cuenta está suscrita a `PAYMENT.CAPTURE.*`, no a `CHECKOUT.ORDER.*`.
   * Ahí el recurso ES el capture (`id`/`status`/`amount` en la raíz, sin
   * `purchase_units`), shape que el handler antes no leía: cada cobro salía
   * por `skipped`. Duele cuando la clienta cierra la pestaña antes de volver,
   * que es justo para lo que existe el webhook.
   */
  test("PAYMENT.CAPTURE.COMPLETED registra el pago", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "paypal", "therapy-12");
    const captureId = nextProviderId("CAP");

    await postPayPalWebhook(baseURL!, {
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      reference: chk.checkoutReference!,
      captureId,
      shape: "capture",
      payerEmail: testEmail("capture.paypal"),
    });

    expect(
      await paymentsFor(captureId),
      "el webhook descartó un cobro real por no reconocer el shape del evento"
    ).toHaveLength(1);
  });

  test("PAYMENT.CAPTURE.REFUNDED marca el pago REFUNDED", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "paypal", "therapy-24");
    const captureId = nextProviderId("CAP");

    await postPayPalWebhook(baseURL!, {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: chk.checkoutReference!,
      captureId,
      shape: "order",
      payerEmail: testEmail("refund.paypal"),
    });
    await postPayPalWebhook(baseURL!, {
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      reference: chk.checkoutReference!,
      captureId,
      shape: "refund",
    });

    const pagos = await paymentsFor(captureId);
    expect(pagos[0]?.status, "el reembolso no se refleja en el CRM").toBe(
      "REFUNDED"
    );
  });

  /**
   * El escenario que dejaba entregas en rojo en el panel de PayPal.
   *
   * `registerWebhookEvent` marca el evento al entrar. Si el handler falla, la
   * marca se quedaba puesta y el reintento salía por "duplicado" sin hacer
   * nada: el cobro no se registraba nunca y PayPal seguía reintentando contra
   * un no-op.
   *
   * El fallo se provoca con un PRODUCTO inexistente. Antes se usaba un contacto
   * inexistente, pero eso ya no falla a propósito: una ficha borrada se
   * reconstruye desde los datos del pagador, porque un cobro hecho hay que
   * registrarlo igual.
   */
  test("tras un fallo, el reintento del mismo evento sí registra el pago", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "paypal", "therapy-1");
    const captureId = nextProviderId("CAP");
    const eventId = `WH-RETRY-${captureId}`;

    const roto = await postPayPalWebhook(baseURL!, {
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      reference: "chk:contacto-que-no-existe:producto-que-no-existe",
      captureId,
      shape: "capture",
      eventId,
    });
    expect(roto.status, "se esperaba que el handler fallara").toBe(500);
    expect(await paymentsFor(captureId)).toHaveLength(0);

    const reintento = await postPayPalWebhook(baseURL!, {
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      reference: chk.checkoutReference!,
      captureId,
      shape: "capture",
      eventId,
      payerEmail: testEmail("reintento"),
    });
    expect(reintento.status).toBe(200);

    expect(
      await paymentsFor(captureId),
      "el reintento se descartó como duplicado y el cobro se perdió"
    ).toHaveLength(1);
  });

  test("un evento sin referencia no crea nada", async ({ baseURL }) => {
    const captureId = nextProviderId("CAP");
    const r = await postPayPalWebhook(baseURL!, {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: "",
      captureId,
      shape: "order",
    });
    expect(r.status).toBe(200);
    expect(await paymentsFor(captureId)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("Mercado Pago · webhook", () => {
  test("firma inválida se rechaza con 401", async ({ baseURL }) => {
    const r = await postMercadoPagoWebhook(baseURL!, "123456", {
      validSignature: false,
    });
    expect(r.status).toBe(401);
  });

  test("firma válida se acepta", async ({ baseURL }) => {
    // El id no existe en MP: la ruta responde 200 y descarta en `after()`.
    const r = await postMercadoPagoWebhook(baseURL!, "999999999");
    expect(r.status).toBe(200);
  });

  // Los estados de Mercado Pago (`pending`, `rejected`) se prueban en
  // `mercadopago-estados.spec.ts`: el estado se lee de la API de MP, no del
  // cuerpo del webhook, así que no se puede provocar por HTTP.
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("Membresía · el mes se suma una sola vez", () => {
  test("dos pagos aprobados avanzan paidUntil un mes cada uno", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "paypal", "course-live");
    const email = testEmail("membresia");

    const first = nextProviderId("CAP");
    await postPayPalWebhook(baseURL!, {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: chk.checkoutReference!,
      captureId: first,
      shape: "order",
      amount: "37.19",
      payerEmail: email,
    });

    const afterFirst = await enrollmentOf(chk.contactId!, "course-live");
    const t1 = afterFirst?.paidUntil;
    expect(t1, "el primer pago no abrió acceso").toBeTruthy();

    // Reenvío del MISMO pago: no debe regalar otro mes.
    await postPayPalWebhook(baseURL!, {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: chk.checkoutReference!,
      captureId: first,
      shape: "order",
      amount: "37.19",
      payerEmail: email,
    });
    const afterReplay = await enrollmentOf(chk.contactId!, "course-live");
    expect(
      afterReplay?.paidUntil?.getTime(),
      "un reenvío regaló un mes de más"
    ).toBe(t1?.getTime());

    // Segundo pago real (renovación manual): un mes más.
    const second = nextProviderId("CAP");
    await postPayPalWebhook(baseURL!, {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: chk.checkoutReference!,
      captureId: second,
      shape: "order",
      amount: "37.19",
      payerEmail: email,
    });

    const afterSecond = await enrollmentOf(chk.contactId!, "course-live");
    const days =
      (afterSecond!.paidUntil!.getTime() - t1!.getTime()) / 86_400_000;
    expect(days, `avanzó ${days} días en vez de un mes`).toBeGreaterThanOrEqual(
      28
    );
    expect(days).toBeLessThanOrEqual(31);

    // La renovación reusa la matrícula, no crea una segunda.
    const todas = await db.enrollment.findMany({
      where: { contactId: chk.contactId!, productId: "course-live" },
    });
    expect(todas).toHaveLength(1);
    expect(afterSecond!.payments).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("Recompra · el CRM no puede rechazar dinero ya cobrado", () => {
  test("quien ya tiene una terapia activa puede comprar otra", async ({
    baseURL,
  }) => {
    /**
     * Pasó en producción y costó 599.68 USD: una clienta con terapia activa
     * compró otro paquete, PayPal capturó, y `createEnrollment` lo rechazó por
     * "ya tiene una terapia activa". La captura devolvió 500 y en el CRM no
     * quedó ni el pago ni la matrícula, con el dinero cobrado.
     */
    const email = testEmail("recompra");

    const primera = await createCheckout(baseURL!, "paypal", "therapy-1");
    const cap1 = nextProviderId("CAP");
    await postPayPalWebhook(baseURL!, {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: primera.checkoutReference!,
      captureId: cap1,
      shape: "order",
      payerEmail: email,
      payerFirst: "Recompra",
    });

    const activa = await enrollmentOf(primera.contactId!, "therapy-1");
    expect(activa?.status, "la primera compra no quedó activa").toBe("ACTIVE");

    // Segunda compra, MISMA persona (mismo email), otro paquete.
    const segunda = await createCheckout(baseURL!, "paypal", "therapy-12");
    const cap2 = nextProviderId("CAP");
    const r = await postPayPalWebhook(baseURL!, {
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      reference: segunda.checkoutReference!,
      captureId: cap2,
      shape: "capture",
      payerEmail: email,
      payerFirst: "Recompra",
    });

    expect(r.status, "el webhook devolvió error sobre un cobro real").toBe(200);
    expect(
      await paymentsFor(cap2),
      "la segunda compra se perdió: dinero cobrado y nada en el CRM"
    ).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("Contacto · la referencia puede apuntar a una ficha borrada", () => {
  test("si el contacto de la referencia ya no existe, el pago se registra igual", async ({
    baseURL,
  }) => {
    /**
     * El temporal puede desaparecer entre el checkout y el webhook: lo barre la
     * limpieza nocturna, o se borra al resolver una colisión de email. El
     * webhook llega después — a veces días después con un pago en efectivo.
     *
     * Antes reventaba con una violación de clave foránea y el pago se perdía.
     * Pasó en producción con un cobro real de 599.68 USD.
     */
    const chk = await createCheckout(baseURL!, "paypal", "therapy-1");
    const captureId = nextProviderId("CAP");
    const email = testEmail("contacto.fantasma");

    // Se borra el contacto: la referencia queda apuntando a la nada.
    await db.contact.delete({ where: { id: chk.contactId! } });

    const r = await postPayPalWebhook(baseURL!, {
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      reference: chk.checkoutReference!,
      captureId,
      shape: "capture",
      payerEmail: email,
      payerFirst: "Fantasma",
    });

    expect(r.status, "el webhook falló sobre un cobro real").toBe(200);
    const pagos = await db.payment.findMany({
      where: { providerPaymentId: captureId },
      include: { enrollment: { include: { contact: true } } },
    });
    expect(
      pagos,
      "el pago se perdió porque su contacto había desaparecido"
    ).toHaveLength(1);
    expect(pagos[0].enrollment.contact.email).toBe(email);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("Contacto · colisión de email", () => {
  test("si ya existe una ficha real con ese email, se matricula en ESA", async ({
    baseURL,
  }) => {
    const email = testEmail("colision");
    const existente = await db.contact.create({
      data: {
        phoneE164: `+5730000${Date.now().toString().slice(-5)}`,
        firstName: "Ficha",
        lastName: "Existente",
        email,
      },
    });

    const chk = await createCheckout(baseURL!, "paypal", "therapy-1");
    const captureId = nextProviderId("CAP");
    await postPayPalWebhook(baseURL!, {
      eventType: "CHECKOUT.ORDER.COMPLETED",
      reference: chk.checkoutReference!,
      captureId,
      shape: "order",
      payerEmail: email,
      payerFirst: "Ficha",
    });

    const pagos = await db.payment.findMany({
      where: { providerPaymentId: captureId },
      include: { enrollment: true },
    });
    expect(pagos).toHaveLength(1);
    expect(
      pagos[0].enrollment.contactId,
      "se creó una segunda ficha en vez de reusar la existente"
    ).toBe(existente.id);

    // El contacto temporal debe haber desaparecido.
    expect(await contactById(chk.contactId!)).toBeNull();
  });
});
