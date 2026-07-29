import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { getProduct } from "@/lib/crm/products";
import { createPendingPaymentEnrollment } from "@/lib/crm/enrollments";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

/**
 * Cierra el hueco que obligaba a mandar al operador a `/admin/enrollments` a
 * mitad de una conversación: sin esto no había forma de darle a un contacto
 * su primer paquete de terapia sin salir del panel del agente.
 *
 * Crea en PENDING_PAYMENT — nunca ACTIVE. `createPendingPaymentEnrollment` es
 * el mismo camino que usa el checkout público, así que el precio y la moneda
 * salen del producto, no de lo que diga el operador. Activar la inscripción y
 * generar el paquete de terapia (`ensureTherapyPackage`) sigue pasando por
 * `record_manual_payment` → `markEnrollmentPaid`, igual que cualquier otro
 * pago: esta tool nunca concede sesiones sin ese registro.
 */
export default defineTool({
  description:
    "Create a PENDING_PAYMENT enrollment for a contact on a therapy product (from list_products), the step that was missing before a new or unregistered client's session could be scheduled. It never activates anything and never grants sessions by itself — record the payment afterward with request_payment_otp + record_manual_payment against the enrollmentId this returns, which is what actually activates it and creates the therapy package. Refuses any product that isn't kind THERAPY; for a course or workshop, tell the operator to use /admin/enrollments instead of trying to force it through this tool.",
  inputSchema: z.object({
    contactId: z.string().min(1),
    productId: z
      .string()
      .min(1)
      .describe("A THERAPY-kind product id from list_products, e.g. therapy-3."),
  }),
  approval: always(),
  async execute({ contactId, productId }, ctx) {
    requireWriteStaff(ctx);

    const product = await getProduct(productId);
    if (!product) throw new Error("Ese producto no existe.");
    if (product.kind !== "THERAPY") {
      throw new Error(
        `"${product.title}" no es un producto de terapia (es ${product.kind}). Esta tool solo crea inscripciones de terapia — para curso o taller usa /admin/enrollments.`
      );
    }

    const enrollment = await createPendingPaymentEnrollment({ contactId, productId });

    await auditAgentWrite(ctx, {
      action: "CREATE",
      entityType: "Enrollment",
      entityId: enrollment.id,
      changes: { contactId, productId, status: "PENDING_PAYMENT" },
    });

    return {
      enrollmentId: enrollment.id,
      product: enrollment.product.title,
      sessionsTotal: enrollment.sessionsTotal,
      currency: enrollment.currency,
      amountMinor: enrollment.amountMinor,
      note: "Todavía en PENDING_PAYMENT. Registra el pago (request_payment_otp + record_manual_payment) contra este enrollmentId para activarla y crear el paquete de terapia.",
    };
  },
});
