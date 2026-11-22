import type { Scenario } from "./scenarios";

/**
 * Casos de los incidentes del 16 al 21 de noviembre (auditoría del 21-nov y fase 5: «los
 * errores de producción se vuelven casos»). Cada uno es lo que le llegó a una persona real.
 */
type Line = Scenario["transcript"][number];
const ai = (body: string): Line => ({ direction: "OUTBOUND", body, isAutoReply: true });
const dayana = (body: string): Line => ({ direction: "OUTBOUND", body, isAutoReply: false });
const person = (body: string): Line => ({ direction: "INBOUND", body, attachment: null });

/** Nada de texto interno: herramientas, «category=», guiones bajos, JSON. */
const NO_INTERNAL = [/\b[a-z]+_[a-z_]+\b/i, /category\s*=|severity\s*=/i, /\bescalo\b/i];

export const SCENARIOS_21NOV: Scenario[] = [
  {
    id: "ever-si-esta-bien-tras-agendar",
    origin: "Ever Lidueña, 21-nov: tras agendar, «Si esta bien» y le llegó «Confirm_appointment»",
    stage: "llamada_agendada",
    name: "Ever Lidueña",
    phone: "573001112233",
    hasBooking: true,
    backing: ["domingo, 22 de noviembre, 8:00 a. m."],
    transcript: [
      person("Para mañana domingo"),
      ai("Listo. Tu llamada gratis con Dayana quedó para el domingo, 22 de noviembre, 8:00 a. m. Dayana te llama por WhatsApp a este número."),
      person("Si esta bien"),
    ],
    expect: { mustNotMatch: NO_INTERNAL },
    goal: "Un cierre corto y cálido («Con gusto, ten un lindo día»: sin apodos) o nada. Nunca texto interno ni el nombre de una herramienta, y no vuelve a ofrecer horas.",
  },
  {
    id: "leiner-despues-de-las-2",
    origin: "Dr Leiner, 16-nov: «¿No tienes después de las 2?» → el modelo escribió «2:30p», el freno lo paró y solo le llegó «Déjame revisar la agenda»",
    name: "Dr Leiner Felipe Guaca",
    phone: "573005556677",
    transcript: [
      person("Si"),
      ai("Claro, te comparto los espacios que tiene Dayana disponibles\n\n1. Jueves, 15 de octubre, 1:45 p. m.\n\n¿Te la agendo? Respóndeme «sí» o dime otra hora que te sirva."),
      person("No alcanzo, tengo un pendiente y me desocupo mas tardar 2:15"),
      ai("Entiendo perfectamente.\n\n1. Jueves, 15 de octubre, 1:45 p. m.\n\n¿Te la agendo? Respóndeme «sí» o dime otra hora que te sirva."),
      person("No tienes después de las 2?"),
    ],
    expect: { outcome: "reply", mustNotMatch: [/d[eé]jame (revisar|consultar)/i, ...NO_INTERNAL] },
    goal: "Le da horas reales de la agenda después de las 2:00 p. m. (o le dice que la siguiente libre es la que ya tiene y le ofrece otro día), nunca «Déjame revisar la agenda» sin horas.",
  },
  {
    id: "gissella-datos-western-union",
    origin: "Gissella, 14-nov: «te comparto los datos de Western Union» y nunca llegaron (dos veces)",
    name: "Gissella",
    phone: "51987654321",
    transcript: [
      dayana("Mi bella, el paquete de 3 sesiones está en 185 USD. Quedo atenta para iniciar."),
      person("Ok, ¿me pasas los datos para pagar desde Perú?"),
    ],
    expect: { outcome: "reply", mustMatch: [/00000000002/], mustNotMatch: NO_INTERNAL },
    goal: "Le manda los datos de pago de fuera de Colombia (Western Union, la cuenta de prueba 00000000002) y le pide el comprobante. Nunca la promesa sin los datos.",
  },
  {
    id: "mehmet-halagos-romanticos",
    origin: "Mehmet (Turquía), 16-nov: «Hola mi amor… me gustas mucho» y le llegó «Escalo con category=other, severity=normal…»",
    name: "Mehmet Ata Algül",
    phone: "905001112233",
    transcript: [
      person("Hola mi amor, vi tus fotos y me impresionaste mucho. Tu rostro es tan hermoso, eres maravillosa"),
      ai("Hola, te bendigo. Soy la asistente de Dayana. Agradezco tus palabras, pero te pido que mantengamos el respeto. ¿En qué te podemos ayudar?"),
      person("Me gustas mucho"),
    ],
    expect: { mustNotMatch: NO_INTERNAL },
    goal: "Pone un límite con respeto (es el canal profesional de Dayana) o se lo pasa a Dayana con un aviso normal. Nunca texto interno («Escalo con category=…»), nunca le sigue el juego.",
  },
  {
    id: "huevos-comunidad-tras-llamada",
    origin: "«Huevos al por mayor», 19-nov: tras su llamada pidió «Agrégame a la comunidad» y le llegó «¿Pudiste hablar con Dayana?»",
    name: "Huevos Al Por Mayor Y al Detalle",
    stage: "tuvo_llamada",
    transcript: [
      dayana("Fue un gusto hablar contigo. Escribe aquí para que te agreguen en la comunidad."),
      person("Agrégame a la comunidad"),
    ],
    expect: { outcome: "reply", mustMatch: [/chat\.whatsapp\.com/] },
    goal: "Recibe el enlace de la comunidad enseguida, aunque ya tuvo su llamada (la IA callada tras la llamada no lo frena).",
  },
];
