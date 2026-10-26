/**
 * El mensaje de WhatsApp (y SMS) que sale cuando entra un pago.
 *
 * Antes era la plantilla de terapia para todo («recibimos tu pago por {{producto}}.
 * Quedan {{sesiones}} sesiones por agendar. Escríbeme para coordinar tu primera
 * cita»): a quien pagó el taller le llegó «Quedan 0 sesiones por agendar»
 * (Natividad, Victorino, 25-oct) y a una ficha temporal «Hola Pendiente». Dueña:
 * «no tiene sentido, la única que aprueba pagos es Dayana o una persona».
 *
 * Así que un pago que entró solo por la página (PayPal, Mercado Pago) no se
 * anuncia como aprobado: «gracias, Dayana lo revisa y te confirma». Si lo
 * registró Dayana (MANUAL), ella ya lo confirmó. Y cada producto con lo suyo:
 * el taller (el cupo), la terapia (agendar sus sesiones), lo demás sin sesiones.
 *
 * Puro: lo usa `payment-confirmation.ts` y las pruebas.
 */

export type PaymentChatInput = {
  /** El nombre de la ficha; «Pendiente» (la temporal del checkout) no se usa. */
  firstName: string | null;
  product: string;
  kind: "THERAPY" | "COURSE" | "WORKSHOP" | "OTHER";
  provider: "PAYPAL" | "MERCADO_PAGO" | "MANUAL";
  /** Sesiones del paquete (terapia); 0 o null: no se mencionan. */
  sessions: number | null;
};

const greeting = (firstName: string | null) => {
  const name = firstName?.trim();
  return name && name.toLowerCase() !== "pendiente" ? `Hola ${name} 🙏` : "Hola 🙏";
};

export const paymentChatMessage = (input: PaymentChatInput): string => {
  const hi = greeting(input.firstName);
  const confirmed = input.provider === "MANUAL";
  if (input.kind === "WORKSHOP") {
    return confirmed
      ? `${hi} Dayana confirmó tu pago ✅ Ya quedó separado tu cupo en el taller «${input.product}». Antes del taller te compartimos los detalles por aquí.`
      : `${hi} Gracias por inscribirte al taller «${input.product}». Dayana revisa tu pago y te confirma por aquí; antes del taller te compartimos los detalles.`;
  }
  if (input.kind === "THERAPY" && input.sessions && input.sessions > 0) {
    return confirmed
      ? `${hi} Dayana confirmó tu pago de «${input.product}» ✅ Te escribe por aquí para agendar tus sesiones.`
      : `${hi} Gracias por tu pago de «${input.product}». Dayana lo revisa y te escribe por aquí para agendar tus sesiones.`;
  }
  return confirmed
    ? `${hi} Dayana confirmó tu pago de «${input.product}» ✅`
    : `${hi} Gracias por tu pago de «${input.product}». Dayana lo revisa y te confirma por aquí.`;
};
