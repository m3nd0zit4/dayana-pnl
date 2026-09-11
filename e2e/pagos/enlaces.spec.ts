import { expect, test } from "@playwright/test";
import crypto from "crypto";
import {
  createCheckout,
  db,
  nextPhone,
  testEmail,
  TEST_EMAIL_DOMAIN,
} from "./helpers";

/**
 * Enlaces de pago (`/pagar/<token>`).
 *
 * Este canal iba a quedarse sin catálogo delante, así que pasa a ser la vía
 * principal de venta — y no tenía una sola prueba.
 *
 * Lo que de verdad se comprueba aquí es que **el cobro se cuelga de la ficha a
 * la que se mandó el enlace**. Antes no: `startCheckout` no llevaba nada que
 * identificara a la compradora, la creación de la orden caía en la rama
 * anónima y fabricaba un contacto `+pending:` nuevo. Dayana mandaba el enlace
 * a una clienta conocida y la matrícula aparecía en un duplicado, reconciliado
 * más tarde sólo si el email del pagador coincidía por casualidad.
 */

const PRODUCT = "therapy-1";

const makeContact = async (slug: string) =>
  db.contact.create({
    data: {
      firstName: "Enlace",
      lastName: slug,
      email: testEmail(`enlace-${slug}-${Date.now()}`),
      phoneE164: nextPhone(),
      source: "MANUAL",
    },
    select: { id: true },
  });

const makeLink = async (
  contactId: string,
  overrides: { expiresAt?: Date | null; revokedAt?: Date | null } = {}
) =>
  db.paymentLink.create({
    data: {
      token: crypto.randomBytes(16).toString("hex"),
      contactId,
      productId: PRODUCT,
      expiresAt: overrides.expiresAt ?? null,
      revokedAt: overrides.revokedAt ?? null,
    },
    select: { token: true, id: true },
  });

test.afterAll(async () => {
  await db.paymentLink.deleteMany({
    where: { contact: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } },
  });
  await db.$disconnect();
});

test.describe("Enlace de pago · a quién se le cobra", () => {
  test("el cobro sale a la ficha del enlace, no a un contacto nuevo", async ({
    baseURL,
  }) => {
    const contact = await makeContact("dueno");
    const link = await makeLink(contact.id);

    const res = await createCheckout(baseURL!, "paypal", PRODUCT, {
      paymentLinkToken: link.token,
    });

    expect(res.status).toBe(200);
    // La afirmación entera de este fichero.
    expect(res.contactId).toBe(contact.id);

    // Y no se ha fabricado ningún temporal por el camino.
    const placeholders = await db.contact.count({
      where: { phoneE164: { startsWith: "+pending:" }, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    expect(placeholders).toBe(0);
  });

  test("Mercado Pago hace lo mismo", async ({ baseURL }) => {
    const contact = await makeContact("mp");
    const link = await makeLink(contact.id);

    const res = await createCheckout(baseURL!, "mercadopago", PRODUCT, {
      paymentLinkToken: link.token,
    });

    expect(res.status).toBe(200);
    expect(res.contactId).toBe(contact.id);
  });

  test("un token de otro producto NO puede cobrar en nombre de esa ficha", async ({
    baseURL,
  }) => {
    const contact = await makeContact("cruzado");
    const link = await makeLink(contact.id); // enlace de therapy-1

    // Se intenta usar para therapy-6. El enlace es válido y el token es real,
    // pero autoriza un cobro concreto: dejar que sirva para otro producto
    // convertiría un enlace de 90.000 en uno de 350.000 a nombre de la misma
    // persona.
    const res = await createCheckout(baseURL!, "paypal", "therapy-6", {
      paymentLinkToken: link.token,
    });

    expect(res.status).toBe(200);
    expect(res.contactId).not.toBe(contact.id);
  });

  test("un enlace revocado no presta su ficha", async ({ baseURL }) => {
    const contact = await makeContact("revocado");
    const link = await makeLink(contact.id, { revokedAt: new Date() });

    const res = await createCheckout(baseURL!, "paypal", PRODUCT, {
      paymentLinkToken: link.token,
    });

    expect(res.status).toBe(200);
    expect(res.contactId).not.toBe(contact.id);
  });

  test("un enlace caducado tampoco", async ({ baseURL }) => {
    const contact = await makeContact("caducado");
    const link = await makeLink(contact.id, {
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const res = await createCheckout(baseURL!, "paypal", PRODUCT, {
      paymentLinkToken: link.token,
    });

    expect(res.status).toBe(200);
    expect(res.contactId).not.toBe(contact.id);
  });

  test("un token inventado no rompe el pago, sólo no identifica", async ({
    baseURL,
  }) => {
    // Importa que NO reviente: quien llega con un token viejo o manipulado
    // debe poder pagar igual; lo único que pierde es la vinculación.
    const res = await createCheckout(baseURL!, "paypal", PRODUCT, {
      paymentLinkToken: "no-existe-este-token",
    });

    expect(res.status).toBe(200);
    expect(res.contactId).toBeTruthy();
  });

  test("el importe sigue llevando el gross-up", async ({ baseURL }) => {
    const contact = await makeContact("comision");
    const link = await makeLink(contact.id);

    const res = await createCheckout(baseURL!, "paypal", PRODUCT, {
      paymentLinkToken: link.token,
    });

    const price = await db.productPrice.findFirst({
      where: { productId: PRODUCT, currency: "USD" },
      orderBy: { validFrom: "desc" },
    });
    const net = (price?.amountMinor ?? 0) / 100;

    expect(res.status).toBe(200);
    // Lo cobrado tiene que ser MAYOR que el neto anunciado: si el enlace
    // cobrara el neto, Dayana pagaría la comisión de su bolsillo en cada venta
    // del canal principal.
    expect(Number(res.amountValue)).toBeGreaterThan(net);
  });
});
