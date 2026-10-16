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
  /** El nombre como llega (perfil de WhatsApp o contacto): puede no ser un nombre. */
  name: string;
  /** Cómo habló de sí la persona; «unknown»: no lo dijo (la asistente escribe sin género). */
  gender?: "f" | "m" | "unknown";
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
    gender: "m",
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
    gender: "m",
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
    id: "perlita-comprobante-disculpa",
    origin: "Perlita, 15-oct: tras el comprobante se disculpó por la demora y la IA repitió «Ya le aviso a Dayana para que lo revise»",
    name: "Perlita",
    gender: "f",
    stage: "por_revisar",
    transcript: [
      person("Hola Dayana lindo día"),
      person("Mñn te deposito lo de este mes por favor veo las grabaciones trato de hacer los talleres muy importantes por cierto"),
      person("Grqcias y una disculpa por la tardanza en los pagos 😞"),
      dayana("🎤 Hola mi hermosa, te bendigo. No hay problema, mi bella. Quedo atenta. Te envío un abrazo."),
      person("", "imagen"),
      ai("Recibido, Perlita. Ya le aviso a Dayana para que lo revise y te confirmamos."),
      person("Lo de mes de octubre por favor  Dayana y una disculpa la tardanza 🫢😬"),
      person("Gracias"),
    ],
    expect: { mustNotMatch: [/le aviso a dayana|para que lo revise|lo revisa|te confirmamos/i, /pago (está |quedó )?confirmado/i] },
    goal: "No repite que Dayana revisa el comprobante (ya se lo dijo): o no le escribe, o contesta algo corto y cálido («No te preocupes, Perlita 🙏», «Con gusto»). No confirma el pago ella misma.",
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
  {
    id: "comunidad-pide-entrar",
    origin: "DIOS ES MI PROVEEDOR, 14-oct: pidió que la agregaran a la comunidad; la IA dijo «Dayana te agrega» y «Sí, Dios es mi proveedor»",
    name: "DIOS ES MI PROVEEDOR 🙏",
    gender: "f",
    stage: "tuvo_llamada",
    personTimezone: "America/Caracas",
    transcript: [
      person("Buen día, como está sra Dayanna? Por favor saber información sobre las terapias"),
      dayana("Hola bns días te bendigo"),
      dayana("Claro q si si gustas podemos agendar una llamada"),
      person("Yo vivo en San Cristóbal, Venezuela, sería a las 10 de la mañana hora venezolana si"),
      dayana("Ok te llamo 9:00 am hora Bogotá"),
      dayana("Y 10 am hora Venezuela"),
      person("Si muchas gracias"),
      person("Estoy atenta"),
      person("Buenas noches sra Dayana, por favor me podría agregar al grupo de su  comunidad..."),
    ],
    expect: { outcome: "reply", anyTool: ["send_community_link"], noTool: ["escalate"], mustNotMatch: [/dios es mi proveedor/i] },
    goal: "Le manda el enlace de la comunidad de Dayana (con la herramienta) en un mensaje corto para que entre. No escala, no dice que Dayana la va a agregar y no la llama por su nombre de perfil («Dios es mi proveedor»).",
  },
  {
    id: "comunidad-insiste",
    origin: "DIOS ES MI PROVEEDOR, 14-oct: la IA ya había dicho «Déjame consultarlo con Dayana» y la persona insiste",
    name: "DIOS ES MI PROVEEDOR 🙏",
    gender: "f",
    stage: "tuvo_llamada",
    transcript: [
      person("Buenas noches sra Dayana, por favor me podría agregar al grupo de su  comunidad..."),
      ai("Déjame consultarlo con Dayana y te confirmo por aquí."),
      person("Gracias. ..Vi por tictok ella habló de la comunidad pero no pude hacer lo \nCreo que es más fácil para que me agregue"),
    ],
    expect: { outcome: "reply", anyTool: ["send_community_link"], mustNotMatch: [/dios es mi proveedor/i, /d[ée]jame (consultarlo|avisarle)/i] },
    goal: "Le manda ya el enlace de la comunidad para que entre (se puede unir con el enlace), sin repetir que lo consulta con Dayana.",
  },
  {
    id: "no-le-alcanza-ahorrare",
    origin: "SF, 14-oct: «primero ahorraré y luego me inscribiré» y la IA contestó «Cuando estés lista» (sin ofrecer nada)",
    name: "SF",
    gender: "unknown",
    personTimezone: "America/Lima",
    transcript: [
      person("Hola Dayana, te escribo desde tu página de enlaces."),
      person("Dra. Buenas tardes"),
      ai("Hola, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"),
      person("Por favor quisiera más información sobre sus cursos"),
      ai("Claro que sí. Si gustas, programamos una llamada para darte la información y explicarte la metodología. ¿Desde qué país me escribes?"),
      person("De Perú, a qué hora y qué día podría ser la llamada?"),
      person("Disculpe cuál será el costo del curso?"),
      dayana("Claro que sí, hay agenda disponible el día de hoy a las 4:15 Pm y se te da toda la información del curso. Conversas directamente con Dayana"),
      person("Disculpe lo he pensado, primero ahorraré y luego me inscribire, gracias"),
    ],
    expect: { outcome: "reply", anyTool: ["send_community_link", "send_affordable_option"], mustNotMatch: [/\bSF\b/] },
    goal: "Lo respeta sin insistir y le ofrece lo que sí puede hacer ya: entrar gratis a la comunidad de Dayana y/o el curso en vivo en grupo (con las herramientas, sin precios), y le recuerda que la llamada con Dayana no tiene costo. Escribe sin género (no «lista» ni «listo»).",
  },
  {
    id: "no-le-alcanza-tras-llamada",
    origin: "Pedido de la dueña, 14-oct: a quien no le alcanza, ofrecerle el curso o la comunidad",
    name: "Marcela",
    gender: "f",
    stage: "tuvo_llamada",
    personTimezone: "America/Bogota",
    transcript: [
      person("Gracias doctora por la llamada, me sirvió mucho"),
      dayana("Con gusto, te bendigo. Cualquier cosa me escribes."),
      person("Doctora la verdad ahorita no me alcanza para pagar las sesiones, estoy muy apretada con la plata"),
    ],
    expect: { outcome: "reply", anyTool: ["send_community_link", "send_affordable_option"] },
    goal: "Con empatía, sin insistir en la terapia ni hablar de valores, le ofrece entrar gratis a la comunidad de Dayana y el curso en vivo como opción más económica (con las herramientas), y deja la puerta abierta.",
  },
  {
    id: "perfil-no-es-nombre",
    origin: "DIOS ES MI PROVEEDOR, 13-oct: la IA propuso «Hola DIOS ES MI PROVEEDOR, te bendigo»",
    name: "DIOS ES MI PROVEEDOR 🙏",
    gender: "unknown",
    transcript: [person("Buen día, como está sra Dayanna? Por favor saber información sobre las terapias")],
    expect: { outcome: "reply", mustNotMatch: [/dios es mi proveedor|proveedor/i] },
    goal: "Saluda sin nombre (su perfil «DIOS ES MI PROVEEDOR» no es un nombre), se presenta como asistente de Dayana y sigue el flujo de persona nueva; puede preguntarle cómo se llama. Escribe sin género.",
  },
  {
    id: "nombre-dicho-en-el-chat",
    origin: "Samy, 12-oct: perfil «en la universidad 🥰🥰🥰», pero dijo «soy Samy molinares»",
    name: "en la universidad 🥰🥰🥰",
    gender: "unknown",
    transcript: [person("buenas noches"), person("Doctora soy Samy molinares")],
    expect: { outcome: "reply", mustMatch: [/samy/i], mustNotMatch: [/universidad/i] },
    goal: "Saluda a Samy por el nombre que dijo (no por su perfil), se presenta como asistente de Dayana y pregunta cómo está. Escribe sin género (Samy puede ser hombre o mujer).",
  },
  {
    id: "enny-audios-cuentas",
    origin: "ENNY, 14-oct: por audio pidió a qué cuenta o Nequi pagar; la IA contestó «Déjame consultarlo con Dayana»",
    name: "ENNY jose",
    gender: "m",
    stage: "tuvo_llamada",
    personTimezone: "America/Bogota",
    transcript: [
      person("🎤 Dra. Agradezco que se haya tomado el tiempo para llamarme. Soy una persona que por las cosas que ya he vivido, soy muy desconfiado.", "audio"),
      dayana("Si deseas una terapia personalizada Virtual, aquí te envío el valor de la inversión. Tan pronto hagas el pago, agendamos un día y ahora que tú me digas"),
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-1"),
      person("🎤 Ok, entonces serían 190.000 pesos. ¿Me indica a qué cuentas se lo puedo transferir? Si es cuenta Nequi u otro tipo de cuenta.", "audio"),
      dayana("Hola buenos días, te habla el Asistente de Dayana Beltrán, no recibimos audio cuéntanos qué información deseas transmitirle a la profesional"),
      person("🎤 Agradezco la información, que usted es el asistente de la doctora. Pero mi único contacto y mi única comunicación la voy a tener con la doctora, por causas personales.", "audio"),
      person("🎤 Lo que quiero saber es a qué cuenta bancaria o Nequi va a recibirme ella el dinero que se requiere para tener la cita personalizada.", "audio"),
    ],
    expect: { outcome: "reply", anyTool: ["send_payment_info", "send_payment_link"], mustNotMatch: [/no (puedo|podemos) (escuchar|oír)|no recibimos audio/i] },
    goal: "Le comparte los datos de pago de Colombia (con la herramienta) en un mensaje corto y respetuoso, le pide el comprobante y le dice que Dayana lo revisa. No discute el monto, no insiste en que hable con la asistente y no dice que no puede oír audios.",
  },
];
