/**
 * El comprobante que llega por WhatsApp de un pago que YA entró por el enlace
 * de la página.
 *
 * Victorino (26-oct) pagó el taller por PayPal y mandó la captura: Dayana
 * confirmó y registró una «Transferencia» encima del mismo pago. De ahí salió
 * (1-nov) que la IA dijera «ya quedó registrado ✅» y enlazara sola el
 * comprobante. La dueña lo cambió el 15-nov (Ana Villalvazo pagó por PayPal y la
 * IA le contestó «Tu pago por el enlace ya quedó registrado ✅»): «que la gente
 * no confirme pagos, así sean registrados en la plataforma, tiene que ser por un
 * humano; puede decir que lo están revisando». Ahora la IA solo dice que lo
 * recibió y que Dayana lo revisa, y el comprobante queda por confirmar: la
 * tarjeta del chat ya le dice a Dayana que ese pago entró por la página
 * («Es ese mismo pago»), así que no se registra dos veces.
 *
 * Puro: sin base de datos.
 */

const isWorkshop = (product: string | null, kind: string | null): boolean =>
  kind === "WORKSHOP" || /\btaller\b/i.test(product ?? "");

/** «Recibido, Dayana lo revisa»: nunca dice que el pago está confirmado ni registrado. */
export const paymentReviewReply = (first: string | null, paid?: { product: string | null; productKind: string | null } | null): string => {
  const thanks = first ? `¡Gracias, ${first}! 🙏` : "¡Gracias! 🙏";
  const what =
    paid && isWorkshop(paid.product, paid.productKind)
      ? `Recibí tu comprobante. Dayana revisa tu pago del taller${paid.product && !/^taller\b/i.test(paid.product) ? ` «${paid.product}»` : ""} y te confirma por aquí.`
      : "Recibí tu comprobante. Dayana revisa tu pago y te confirma por aquí.";
  return `${thanks} ${what} No tienes que enviar nada más.`;
};

/** Lo que le contesta la IA a un comprobante de un pago que ya entró por el enlace. */
export const alreadyPaidReply = (first: string | null, paid: { product: string | null; productKind: string | null }): string =>
  paymentReviewReply(first, paid);

/** Lo que lee el modelo en la respuesta de `register_payment_receipt`. */
export const alreadyPaidToolNote = (label: string): string =>
  `Parece el pago que entró por el enlace de la página (${label}). NO digas que el pago está confirmado, registrado ni aprobado: eso solo lo hace Dayana. El código escribe la respuesta (recibido, Dayana lo revisa).`;

/**
 * ¿La respuesta da el pago por confirmado? Solo Dayana confirma pagos (dueña, 15-nov).
 * «Cuando Dayana confirme tu pago» o «Dayana revisa tu pago» no lo es.
 */
const PAGO = String.raw`(?:tu|el|su)\s+pago\s+(?:[^\s.!?]+\s+){0,4}?(?:ya\s+)?`;
const NO_LETTER_AFTER = String.raw`(?![\p{L}])`;
const CONFIRMED_CLAIM = [
  new RegExp(
    PAGO + String.raw`(?:qued[oó]|est[aá]|fue|ha\s+sido)\s+(?:\S+\s+)?(?:confirmad|registrad|aprobad|recibid|acreditad|verificad)`,
    "iu"
  ),
  new RegExp(
    PAGO + String.raw`(?:se\s+)?(?:registr[oó]|confirm[oó]|aprob[oó]|acredit[oó]|reflej[oó]|verific[oó]|entr[oó]|lleg[oó])` + NO_LETTER_AFTER,
    "iu"
  ),
  new RegExp(
    String.raw`(?:^|[^\p{L}])(?:ya\s+)?(?:confirm[eé]|registr[eé]|aprob[eé]|verifiqu[eé]|confirmamos|registramos|aprobamos|verificamos|recibimos|recib[ií])\s+(?:tu|el|su)\s+pago` +
      NO_LETTER_AFTER,
    "iu"
  ),
  new RegExp(String.raw`(?:^|[^\p{L}])pago\s+(?:confirmado|registrado|aprobado|acreditado|verificado)` + NO_LETTER_AFTER, "iu"),
];
const NOT_A_CLAIM = /(?:^|[^\p{L}])(?:cuando|apenas|en\s+cuanto|tan\s+pronto|una\s+vez\s+que|hasta\s+que|para\s+que|si)(?![\p{L}])[^.!?\n]{0,40}$/iu;

export const claimsPaymentConfirmed = (text: string): boolean =>
  text
    .split(/(?<=[.!?\n])/)
    .some((sentence) =>
      CONFIRMED_CLAIM.some((re) => {
        const m = re.exec(sentence);
        return m !== null && !NOT_A_CLAIM.test(sentence.slice(0, m.index + (m[0].length - m[0].trimStart().length)));
      })
    );
