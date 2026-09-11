import { PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { OPERATIONAL_TZ, getDateKeyInTz } from "@/lib/crm/operational-timezone";

/**
 * El número de recibo, asignado la primera vez que alguien lo pide.
 *
 * Perezoso a propósito. Asignarlo al aprobarse el pago habría dejado sin
 * número a los cobros que ya existían, y habría metido una escritura más
 * dentro del camino del webhook — que es justo donde no conviene añadir nada
 * que pueda fallar.
 *
 * El correlativo sale de `payment_receipt_seq`. `nextval` es atómico incluso
 * entre transacciones concurrentes, así que dos peticiones simultáneas no
 * pueden llevarse el mismo número. Contar filas para calcularlo sí lo habría
 * permitido, y un número de recibo duplicado no es un detalle estético: es lo
 * que rompe una conciliación contable.
 */

export class ReceiptError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "NOT_APPROVED"
  ) {
    super(message);
  }
}

const format = (seq: bigint | number, year: string): string =>
  `REC-${year}-${String(seq).padStart(4, "0")}`;

/**
 * Devuelve el número del pago, creándolo si aún no tenía.
 *
 * Sólo para pagos APROBADOS: un recibo dice «esto se cobró», y emitirlo para
 * un intento rechazado o pendiente sería afirmar algo que no ha pasado.
 */
export const ensureReceiptNumber = async (paymentId: string): Promise<string> => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true, receiptNumber: true, paidAt: true, createdAt: true },
  });

  if (!payment) {
    throw new ReceiptError("Payment not found", "NOT_FOUND");
  }
  if (payment.receiptNumber) return payment.receiptNumber;
  if (payment.status !== PaymentStatus.APPROVED) {
    throw new ReceiptError(
      "Solo los pagos aprobados tienen recibo",
      "NOT_APPROVED"
    );
  }

  // El año es el del cobro y se resuelve en la zona operativa: un pago de las
  // 8 de la noche del 31 de diciembre en Bogotá es de ese año, no del
  // siguiente, que es lo que diría la fecha en UTC.
  const year = getDateKeyInTz(payment.paidAt ?? payment.createdAt, OPERATIONAL_TZ).slice(0, 4);

  const [{ nextval }] = await prisma.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('payment_receipt_seq') AS nextval
  `;
  const receiptNumber = format(nextval, year);

  // `updateMany` con el guardia `receiptNumber: null`: si dos peticiones
  // entraron a la vez, la segunda no pisa el número que puso la primera. Se
  // gasta un valor de la secuencia, que es exactamente lo que las secuencias
  // permiten — un hueco es inofensivo, un número reasignado no.
  const claimed = await prisma.payment.updateMany({
    where: { id: paymentId, receiptNumber: null },
    data: { receiptNumber },
  });

  if (claimed.count === 1) return receiptNumber;

  const current = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { receiptNumber: true },
  });
  return current?.receiptNumber ?? receiptNumber;
};
