/**
 * ¿El cobro recurrente que acaba de llegar es por el importe que debería?
 *
 * Las órdenes sueltas ya lo comprueban (`PLAN_MISMATCH` en
 * `lib/crm/enrollment-payment.ts`) y **bloquean**, porque allí el dinero todavía
 * no se ha capturado. Aquí es al revés: cuando llega el webhook la clienta ya
 * pagó. Rechazar el registro dejaría el cobro sin rastro en el CRM y a alguien
 * que sí pagó sin acceso — mucho peor que cobrar de más. Así que **esto no
 * bloquea nada: avisa**.
 *
 * ## La ventana de gracia de PayPal
 *
 * PayPal no aplica un cambio de precio a los cobros de los 10 días siguientes.
 * Un cobro con el importe ANTERIOR dentro de esa ventana es correcto, no un
 * error, y cantarlo sería enseñar a ignorar la alerta. Por eso se compara
 * contra el importe vigente y también contra el inmediatamente anterior.
 */

import { PaymentProvider } from "@prisma/client";
import { prisma } from "../db";

/** Días en que PayPal sigue cobrando el precio viejo tras un cambio. */
const graceDays = (): number => {
  const raw = Number(process.env.PAYPAL_PRICE_GRACE_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10;
};

export type ChargeCheck = {
  ok: boolean;
  expectedMinor?: number;
  reason?: "no_reference" | "matches_previous" | "mismatch";
};

export const verifySubscriptionChargeAmount = async (input: {
  productId: string;
  provider: PaymentProvider;
  amountMinor: number;
  currency: string;
  paidAt?: Date | null;
}): Promise<ChargeCheck> => {
  const rows = await prisma.productPriceSync.findMany({
    where: {
      productId: input.productId,
      provider: input.provider,
      currency: input.currency.toUpperCase(),
    },
    orderBy: { appliedAt: "desc" },
    take: 2,
  });

  // Sin historial no hay nada contra qué comparar: los planes creados antes de
  // que existiera esta tabla son el caso normal, no una anomalía.
  if (rows.length === 0) return { ok: true, reason: "no_reference" };

  const [current, previous] = rows;
  if (input.amountMinor === current.grossMinor) {
    return { ok: true, expectedMinor: current.grossMinor };
  }

  if (
    previous &&
    input.provider === PaymentProvider.PAYPAL &&
    input.amountMinor === previous.grossMinor
  ) {
    const paidAt = input.paidAt ?? new Date();
    const sinceChange = paidAt.getTime() - current.appliedAt.getTime();
    if (sinceChange <= graceDays() * 24 * 60 * 60 * 1000) {
      return {
        ok: true,
        expectedMinor: current.grossMinor,
        reason: "matches_previous",
      };
    }
  }

  return {
    ok: false,
    expectedMinor: current.grossMinor,
    reason: "mismatch",
  };
};

/**
 * Comprueba y avisa. Nunca lanza: un fallo aquí no puede impedir que se
 * registre un pago que ya se cobró.
 */
export const warnOnUnexpectedSubscriptionCharge = async (input: {
  productId: string;
  provider: PaymentProvider;
  amountMinor: number;
  currency: string;
  paidAt?: Date | null;
  enrollmentId?: string;
  contactName?: string | null;
}): Promise<void> => {
  try {
    const check = await verifySubscriptionChargeAmount(input);
    if (check.ok) return;

    const { emitPlatformNotification } = await import(
      "../notifications/platform/emit"
    );
    const fmt = (minor: number) =>
      input.currency.toUpperCase() === "COP"
        ? `${minor.toLocaleString("es-CO")} COP`
        : `${(minor / 100).toFixed(2)} ${input.currency.toUpperCase()}`;

    await emitPlatformNotification({
      eventType: "SUBSCRIPTION_AMOUNT_MISMATCH",
      title: "Un cobro recurrente no cuadra con el precio del CRM",
      body:
        `Se cobró ${fmt(input.amountMinor)}` +
        (check.expectedMinor != null
          ? ` y se esperaba ${fmt(check.expectedMinor)}`
          : "") +
        (input.contactName ? ` (${input.contactName})` : "") +
        ". El pago se registró igual; revisa el precio del plan.",
      href: "/admin/payments",
      entityType: "Enrollment",
      entityId: input.enrollmentId,
      metadata: {
        provider: input.provider,
        amountMinor: input.amountMinor,
        expectedMinor: check.expectedMinor,
      },
      staff: "ALL",
    });
  } catch {
    // Vigilar no puede romper el registro del pago.
  }
};
