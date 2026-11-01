/**
 * El comprobante que llega por WhatsApp de un pago que YA entró por el enlace
 * de la página (dueña, 1-nov: «cuando una persona paga por el link… se le da
 * como recibido, porque se registra y se confirma a través de nuestra API»).
 *
 * Victorino (26-oct) pagó el taller por PayPal y mandó la captura: la IA le
 * dijo que Dayana lo revisaba, Dayana confirmó y registró una «Transferencia»
 * encima del mismo pago. Ahora la IA le dice que ya está registrado, el
 * comprobante se enlaza solo a ese pago (`run.ts`) y a Dayana solo le llega un
 * aviso: no hay nada que confirmar ni que registrar.
 *
 * Puro: sin base de datos.
 */

const isWorkshop = (product: string | null, kind: string | null): boolean =>
  kind === "WORKSHOP" || /\btaller\b/i.test(product ?? "");

/** Lo que le contesta la IA, en vez de «Recibido, Dayana lo revisa». */
export const alreadyPaidReply = (first: string | null, paid: { product: string | null; productKind: string | null }): string => {
  const thanks = first ? `¡Gracias, ${first}! 🙏` : "¡Gracias! 🙏";
  const what = isWorkshop(paid.product, paid.productKind)
    ? // Sin «inscrita»: el género no se adivina (CLAUDE.md, «Names and gender»).
      `Tu pago por el enlace ya quedó registrado ✅ y tu cupo en el taller${paid.product && !/^taller\b/i.test(paid.product) ? ` «${paid.product}»` : ""} ya está separado.`
    : "Tu pago por el enlace ya quedó registrado ✅";
  return `${thanks} ${what} No tienes que enviar nada más.`;
};

/** Lo que lee el modelo en la respuesta de `register_payment_receipt`. */
export const alreadyPaidToolNote = (label: string): string =>
  `Ese pago YA entró por el enlace de la página (${label}) y está registrado: ya tiene lo que pagó. No digas que Dayana lo revisa ni pidas nada más; el código escribe la respuesta.`;
