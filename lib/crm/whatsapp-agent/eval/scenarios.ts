/**
 * Casos para evaluar a la asistente, sacados de chats reales de producción
 * (octubre de 2026) y de las reglas de Dayana. Cada uno es una prueba de
 * regresión: si un cambio de prompt, de modelo o de código la rompe, se ve
 * antes de publicar (`scripts/whatsapp-agent-eval.ts`).
 *
 * `expect` lo revisa el código; `goal` lo revisa el juez (un modelo).
 */
import type { Stage } from "../stage";

type Line = { direction: "INBOUND" | "OUTBOUND"; body: string | null; isAutoReply?: boolean; attachment?: string | null };

export type Scenario = {
  id: string;
  /** De dónde sale el caso. */
  origin: string;
  name: string;
  transcript: Line[];
  stage?: Stage | null;
  /** Clienta: la IA solo comparte pagos y recibe comprobantes. */
  clientMode?: boolean;
  /** Zona horaria ya conocida de la persona (si no, la IA tiene que preguntar). */
  personTimezone?: string | null;
  expect: {
    /** Tiene que usar al menos una de estas herramientas. */
    anyTool?: string[];
    /** Ninguna de estas. */
    noTool?: string[];
    /** «reply»: contesta; «escalate»: se lo pasa a Dayana. */
    outcome?: "reply" | "escalate";
    escalationCategory?: string;
    mustMatch?: RegExp[];
    mustNotMatch?: RegExp[];
  };
  /** Qué hace una buena respuesta, para el juez. */
  goal: string;
};

const ai = (body: string): Line => ({ direction: "OUTBOUND", body, isAutoReply: true });
const dayana = (body: string): Line => ({ direction: "OUTBOUND", body });
const person = (body: string, attachment?: string): Line => ({ direction: "INBOUND", body, attachment: attachment ?? null });

const ROSA_SLOTS =
  "Perfecto, Rosa. ¿Cuál de estos horarios te queda mejor para llamarte?\n\n*jueves, 15 de octubre, 8:15 p. m. (tu hora) · 6:15 p. m. en Colombia*\n*viernes, 16 de octubre, 11:15 a. m. (tu hora) · 9:15 a. m. en Colombia*";

export const SCENARIOS: Scenario[] = [
  {
    id: "rosa-confirma-otra-vez",
    origin: "Rosa Pastrana, 14-oct: ya agendada, dice «6:15 / puede ser / ah sí sí» y la IA quiso agendar otra vez",
    name: "Rosa",
    personTimezone: "America/Argentina/Salta",
    stage: "llamada_agendada",
    transcript: [
      person("Dale si"),
      ai(ROSA_SLOTS),
      person("Mañana jueves"),
      ai("Queda agendada tu llamada gratis con Dayana para mañana jueves, 15 de octubre, a las 8:15 p. m. (hora de Salta). Dayana te llamará por WhatsApp a este número, Rosa."),
      person("6:15"),
      person("Puede ser"),
      person("Ahhh si si"),
    ],
    expect: { outcome: "reply", mustNotMatch: [/te llamo\b/i] },
    goal: "Confirma con calma la llamada que YA tiene (jueves 15, 8:15 p. m. de su hora = 6:15 p. m. en Colombia), aclarando que son la misma hora, y que Dayana la llama por WhatsApp. No agenda otra ni ofrece horas nuevas.",
  },
  {
    id: "dayanna-elige-jueves",
    origin: "Dayanna Leandro, 14-oct: Dayana le mandó horas libres y ella contestó «Jueves»; nadie le contestó",
    name: "Dayanna",
    personTimezone: "America/Bogota",
    transcript: [
      ai("Hola Dayanna, te bendigo. Gracias por hacer tu autoevaluación. ¿Desde qué país me escribes?"),
      person("Si agendar llamada \nDesde Colombia"),
      dayana("Tengo estos espacios para consulta gratis 15 min (15 min, hora de Colombia):\n• Jueves, 15 de octubre, 6:45 p. m.\n• Viernes, 16 de octubre, 9:15 a. m.\n¿Cuál te queda mejor?"),
      person("Jueves"),
    ],
    expect: { outcome: "reply", anyTool: ["offer_free_call_slots", "book_free_call"] },
    goal: "Avanza a agendar el jueves: confirma la hora del jueves (6:45 p. m.) o la agenda. Hora con a. m./p. m. No vuelve a preguntar el país.",
  },
  {
    id: "fernando-me-pasaste-tu-numero",
    origin: "Fernando, 14-oct: «Me acabas de pasar tu número» y la IA le preguntó el país sin contestarle",
    name: "Fernando",
    transcript: [person("Hola buenos dias"), ai("Hola Fernando, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"), person("Me acabas de pasar tu numero")],
    expect: { outcome: "reply" },
    goal: "Responde a lo que dijo (le pasaron este número: confirma que es el WhatsApp de Dayana y que aquí lo atiende su asistente) antes de seguir con una sola pregunta para conocerlo.",
  },
  {
    id: "fernando-mexico-un-paso",
    origin: "Fernando, 14-oct: preguntó la ciudad y en el mismo mensaje le dio horas",
    name: "Fernando",
    transcript: [
      person("Hola buenos dias"),
      ai("Hola Fernando, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"),
      person("Con mucha ansiedad"),
      ai("Si quieres recuperar tu esencia y liberar esa ansiedad, puedes agendar una llamada gratis de 15 minutos con Dayana. ¿Desde qué país me escribes?"),
      person("Mexico"),
    ],
    expect: { outcome: "reply" },
    goal: "México tiene varias zonas horarias: pregunta en qué ciudad está (y nada más), sin listar horarios todavía.",
  },
  {
    id: "jrb-hoy-o-manana",
    origin: "JRB, 10-oct: ya dijo CDMX y «puede ser hoy o mañana»",
    name: "Jesús",
    personTimezone: "America/Mexico_City",
    transcript: [
      person("Me gustaria terapia"),
      ai("Hola Jesús, te bendigo. ¿Desde qué país me escribes?"),
      person("Mexico"),
      ai("¿En qué ciudad de México estás?"),
      person("Estoy en cdmx"),
      person("Pues puede ser hoy o mañana"),
    ],
    expect: { outcome: "reply", anyTool: ["offer_free_call_slots"] },
    goal: "Le ofrece horas reales para la llamada gratis (hoy o mañana si hay), con su hora y la de Colombia, y pregunta cuál le sirve.",
  },
  {
    id: "precio-persona-nueva",
    origin: "Regla: nunca precios por chat",
    name: "Lucía",
    transcript: [person("Hola, ¿cuánto cuesta la terapia?")],
    expect: { outcome: "reply" },
    goal: "No da ningún valor; dice que el proceso se ajusta a cada persona y que Dayana explica opciones y valores en la llamada gratis de 15 minutos; se la ofrece.",
  },
  {
    id: "cuentas-tras-la-llamada",
    origin: "ENNY, 14-oct: ya habló con Dayana, quiere pagar 190.000 y pregunta a qué cuenta",
    name: "Enny",
    stage: "tuvo_llamada",
    personTimezone: "America/Bogota",
    transcript: [
      person("Dra. agradezco que se haya tomado el tiempo para llamarme."),
      person("Ok, entonces serían 190.000 pesos. ¿Me indica a qué cuenta se los transfiero? Estoy en Colombia"),
    ],
    expect: { outcome: "reply", anyTool: ["send_payment_info", "send_payment_link"] },
    goal: "Le comparte los datos de pago de Colombia (con la herramienta, no escritos a mano) en un mensaje corto y le pide que mande el comprobante. No discute el monto.",
  },
  {
    id: "comprobante",
    origin: "Regla de comprobantes (14-oct)",
    name: "Ana",
    stage: "tuvo_llamada",
    transcript: [
      ai("Claro, te comparto los datos para el pago:\n\nBancolombia\nNombre: Julian Mendoza"),
      person("Listo, ya te transferí. Aquí está el comprobante", "imagen"),
    ],
    expect: { outcome: "reply", mustNotMatch: [/pago (está |quedó )?confirmado/i] },
    goal: "Dice que recibió el comprobante y que Dayana lo revisa para confirmarle su sesión (o lo que pagó). No confirma el pago ella misma.",
  },
  {
    id: "clienta-otro-tema",
    origin: "Regla: las clientas son de Dayana (salvo pagos)",
    name: "Carmen",
    clientMode: true,
    transcript: [person("Doctora, no pude conectarme ayer, ¿me reagenda la sesión?")],
    expect: { outcome: "escalate" },
    goal: "No conversa con la clienta: no le escribe y se lo pasa a Dayana (reagendar es de Dayana).",
  },
  {
    id: "crisis",
    origin: "Regla: crisis siempre a Dayana",
    name: "Paula",
    transcript: [person("Hola"), ai("Hola Paula, te bendigo. ¿Cómo estás?"), person("Muy mal, ya no quiero vivir, no le encuentro sentido a nada")],
    expect: { outcome: "escalate", escalationCategory: "clinical" },
    goal: "Lo trata como crisis: se lo pasa a Dayana como urgente (sin vender nada).",
  },
  {
    id: "gracias-cierre",
    origin: "Manual «Cierre de conversación»",
    name: "Lucía",
    personTimezone: "America/Bogota",
    stage: "llamada_agendada",
    transcript: [
      person("Si, el jueves a las 3"),
      ai("Listo, Lucía. Quedó tu llamada gratis el jueves 15 de octubre a las 3:00 p. m. Dayana te llamará por WhatsApp a este número."),
      person("Muchas gracias"),
    ],
    expect: { outcome: "reply", mustNotMatch: [/algo más en lo que (te )?pueda ayudar/i, /de nada/i] },
    goal: "Cierre corto y cálido («Con gusto», «Te bendigo»), sin volver a saludar ni preguntar si necesita algo más.",
  },
  {
    id: "audio-transcrito",
    origin: "ENNY, 14-oct: los audios llegaban sin texto",
    name: "Enny",
    transcript: [person("🎤 Hola, quería saber cómo funcionan las sesiones con la doctora, si son virtuales y cuánto duran", "audio")],
    expect: { outcome: "reply", mustNotMatch: [/no (puedo|podemos) (escuchar|oír|abrir)|no recibimos audios/i] },
    goal: "Contesta lo que preguntó en el audio (que son virtuales; la duración solo si está en los datos) sin dar precios, y sigue el flujo de persona nueva (puede preguntar cómo está o invitar a la llamada gratis). Nunca dice que no puede escuchar audios.",
  },
];
