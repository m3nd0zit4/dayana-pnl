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
  /** El nombre del perfil de WhatsApp: puede no ser un nombre. */
  name: string;
  /** El nombre que escribió ella en un formulario (contacto del CRM): ese sí es seguro. */
  contactName?: string;
  /** Cómo habló de sí la persona; «unknown»: no lo dijo (la asistente escribe sin género). */
  gender?: "f" | "m" | "unknown";
  transcript: Line[];
  stage?: Stage | null;
  /** Clienta: la IA solo comparte pagos y recibe comprobantes. */
  clientMode?: boolean;
  /** Zona horaria ya conocida de la persona (si no, la IA tiene que preguntar). */
  personTimezone?: string | null;
  /** Ya tiene una cita de verdad (para el freno de promesas, como en run.ts). */
  hasBooking?: boolean;
  /** Horas que ya la respaldan (las que dio la agenda antes, la de su cita). */
  backing?: string[];
  /** CLIENTA EN EL CRM, como lo arma `clientContext` (su inscripción a un evento…). */
  client?: string | null;
  /** Las notas de Dayana sobre la persona (`getMemory`). */
  memory?: string | null;
  expect: {
    /** Tiene que usar al menos una de estas herramientas. */
    anyTool?: string[];
    /** Ninguna de estas. */
    noTool?: string[];
    /** «reply»: contesta; «escalate»: se lo pasa a Dayana; «silent»: no escribe (no_reply). */
    outcome?: "reply" | "escalate" | "silent";
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
    hasBooking: true,
    backing: [ROSA_SLOTS],
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
    hasBooking: true,
    backing: ["jueves 15 de octubre a las 3:00 p. m."],
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
  {
    id: "azul-cdmx-horas-reales",
    origin: "«💙💙💜🩷», 16-oct: dijo «De la CDMX», la IA no guardó la zona, la agenda no respondió y ella inventó «sábado 17, 10:00 a. m. o 4:00 p. m.»",
    name: "💙💙💜🩷",
    transcript: [
      person("Hola buenas tardes"),
      ai("Hola, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"),
      person("Pues ando un poco mal"),
      person("La verdad hoy vi su en live y la verdad me agradó mucho"),
      ai("Lamento mucho que te sientas así. ¿Desde qué país me escribes y en qué ciudad estás?"),
      person("Me gustaría tratarme con usted"),
      person("De la CDMX"),
      ai("Siento mucho que estés pasando por un momento difícil. ¿Cuánto tiempo más quieres seguir con esa tristeza?"),
      person("Ya me gustaría sanar"),
      person("Todas esas emociones"),
      ai("Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso. Ella te escucha y te dice cómo te puede ayudar."),
      person("Ok perfecto"),
    ],
    expect: { outcome: "reply", anyTool: ["offer_free_call_slots"], mustNotMatch: [/(desde|de) (qu[eé]) (pa[ií]s|ciudad)/i] },
    goal: "Ya dijo que es de la CDMX: guarda su zona y le ofrece horas REALES de la agenda (las que da offer_free_call_slots), en su hora y la de Colombia. No inventa horarios ni vuelve a preguntar de dónde es.",
  },
  {
    id: "azul-confirmada-sin-cita",
    origin: "«💙💙💜🩷», 16-oct: eligió una hora inventada y la IA le dijo «Sí, queda confirmada para este sábado» sin agendar nada",
    name: "💙💙💜🩷",
    personTimezone: "America/Mexico_City",
    transcript: [
      ai("Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso. Ella te escucha y te dice cómo te puede ayudar."),
      person("Ok perfecto"),
      ai("Te comparto las opciones de horario para tu llamada gratis de 15 minutos con Dayana: sábado 17 de octubre a las 10:00 a.m. o a las 4:00 p.m. hora de la CDMX. ¿Cuál te queda mejor?"),
      person("El sábado está bien a las 10 de mañana"),
      person("Por favor"),
      person("Y me podría dar costo"),
      ai("Déjame consultarlo con Dayana y te confirmo por aquí."),
      person("Ok muchas gracias"),
      person("Entonces si queda confirmada la llamada el sábado"),
    ],
    expect: { mustNotMatch: [/queda(s)? (confirmad|agendad)|est[aá] (confirmad|agendad)/i] },
    goal: "No confirma una cita que no existe. Agenda de verdad (una hora que dé offer_free_call_slots y luego book_free_call) o le dice con calidez que le confirma el horario por aquí; nunca «queda confirmada» sin haber agendado.",
  },
  {
    id: "valentina-mama-sin-plata-hoy",
    origin: "Valentina Ariza, 16-oct: pidió un favor para su mamá, sin dinero, «hoy mismo a las 3:30 o 4:00»; la IA prometió que Dayana se comunicaba hoy mismo",
    name: "Valentina",
    stage: "por_revisar",
    personTimezone: "America/Bogota",
    transcript: [
      person("Hola dayana"),
      ai("Hola Valentina, te bendigo. ¿Cómo estás?"),
      person("Bien dayana"),
      person("Necesito un favor"),
      person("Para meter a mi mamá dayana"),
      ai("Dime, Valentina, ¿en qué te puedo ayudar?"),
      person("Mi madre está en una cirugía está mal de plata trabaja un local y no hay nada de plata"),
      person("Mi mamá está muy mal mentalmente y económico"),
      person("Hace poco le hicieron una cirugía y ella se está matando la cabeza acostada"),
      person("Hoy mismo"),
      person("Puedes a las 3 30 o a las 4 00"),
      person("?"),
    ],
    expect: {
      noTool: ["book_free_call", "offer_free_call_slots"],
      mustNotMatch: [/hoy mismo/i, /(te|les) llam\w*[^.]*\bhoy\b|se comuni\w*[^.]*\bhoy\b/i, /queda(s)? (confirmad|agendad)/i],
    },
    goal: "Amable pero con límites: no promete que Dayana llama hoy ni a esa hora, no le ofrece ni agenda la llamada gratis (está por revisar, ya fue clienta); le dice que le pasa su mensaje a Dayana y que ella le responde por aquí según su agenda. Si habla del dinero, puede ofrecer la comunidad o la opción económica; nunca algo gratis aparte.",
  },
  {
    id: "solo-puede-los-martes",
    origin: "Pedido de la dueña, 17-oct: si la persona no puede los días ofrecidos, agendar cuando ella pueda",
    name: "Marta",
    personTimezone: "America/Bogota",
    stage: "conversando",
    backing: ["jueves, 15 de octubre, 3:00 p. m.", "jueves, 15 de octubre, 6:45 p. m.", "viernes, 16 de octubre, 9:15 a. m."],
    transcript: [
      person("Hola, quiero la llamada gratis"),
      ai("Con gusto, Marta. Tengo estos espacios para tu llamada gratis de 15 minutos con Dayana:\n\n* jueves, 15 de octubre, 3:00 p. m.\n* jueves, 15 de octubre, 6:45 p. m.\n* viernes, 16 de octubre, 9:15 a. m.\n\n¿Cuál te queda mejor?"),
      person("Ninguno me sirve, yo solo puedo los martes en la tarde"),
    ],
    expect: {
      outcome: "reply",
      anyTool: ["offer_free_call_slots"],
      mustMatch: [/martes/i, /3:00\sp\.\s?m\./i],
      mustNotMatch: [/jueves|viernes/i],
    },
    goal: "Vuelve a buscar con lo que dijo (martes en la tarde) y le ofrece el martes 20 a las 3:00 p. m., la hora real que hay; no repite el jueves ni el viernes ni inventa otras.",
  },
  {
    id: "pricila-inscrita-pide-enlace",
    origin: "Pricila Rojas, 16-oct: inscrita al webinar del 25, escribió «espero el enlace» y la IA le mandó la página de inscripción en vez del Meet",
    name: "Pricila",
    contactName: "Pricila Rojas",
    personTimezone: "America/Bogota",
    client: [
      "Nombre: Pricila Rojas",
      "Etapa: interesada",
      "Todavía no ha comprado nada.",
      "Ya se inscribió en el evento gratuito: Webinar Gratuito «Sana tu historia» (domingo, 25 de octubre, 9:30 a. m. hora de Colombia). Si pide el enlace para entrar, dale el de la reunión de Google Meet, tal cual: https://meet.google.com/abc-defg-hij — no la página de inscripción, porque ya se inscribió.",
    ].join("\n"),
    transcript: [
      ai(
        "Hola Pricila, te bendigo 💛 Gracias por hacer tu autoevaluación. Hola Pricila, quedaste inscrita en «Webinar Gratuito» el domingo 25 de octubre a las 9:30 a. m. (hora de Colombia). Te mando el enlace para entrar por aquí antes de empezar. Quedo atenta a tu respuesta por aquí."
      ),
      person("Hola gracias 😊,espero el enlace"),
    ],
    expect: {
      outcome: "reply",
      mustMatch: [/meet\.google\.com\/abc-defg-hij/],
      mustNotMatch: [/eventos-gratuitos/i],
    },
    goal: "Le da el enlace de Google Meet del webinar (tal cual) con el día y la hora, corto. No le manda la página de inscripción ni le pide que se inscriba: ya se inscribió.",
  },
  {
    id: "fely-gracias-en-su-grupo",
    origin: "Fely Mateo, 18-oct: inscrita al webinar, agradeció «por aceptarme… en su grupo» y la IA le dijo que las grabaciones de las clases y webinars están en el grupo (no hay grabaciones ni está en ningún grupo); la ficha la dio por mujer por el nombre; la saludó «Fely» y luego «Felicitas»",
    name: "Fely Mateo",
    contactName: "Felicitas Mateo",
    gender: "unknown",
    personTimezone: "America/Lima",
    stage: "conversando",
    client: [
      "Nombre en el CRM: Felicitas Mateo (cómo llamarla: mira NOMBRE)",
      "Etapa: interesada",
      "Ya se inscribió en el evento gratuito: Webinar Gratuito «Sana tu historia» (domingo, 25 de octubre, 9:30 a. m. hora de Colombia). Si pide el enlace para entrar, dale el de la reunión de Google Meet, tal cual: https://meet.google.com/abc-defg-hij — no la página de inscripción, porque ya se inscribió.",
    ].join("\n"),
    transcript: [
      person("Hola Dayana, te escribo desde tu página de enlaces."),
      ai("Hola Fely, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"),
      ai("Hola Felicitas, te escribimos porque te inscribiste en «Webinar Gratuito».\n\nFecha: domingo 25 de octubre\nEnlace para ingresar: https://meet.google.com/abc-defg-hij"),
      person("Buenas tardes  muchas gracias"),
      person("Por aceptarme"),
      ai("Con gusto, Felicitas 🙏"),
      person("En su grupo"),
    ],
    expect: {
      outcome: "reply",
      mustNotMatch: [/grabaci|grabad/i, /est[aá]s? en (el|su|nuestro) grupo|en el grupo|ning[uú]n grupo|no (tenemos|hay) (un |ning[uú]n )?grupo/i, /\bFely\b/],
    },
    goal: "Le agradece corto y con calidez: basta «Con gusto 🙏» (el nombre es opcional; si lo usa, «Felicitas», que escribió al inscribirse, nunca «Fely»; no hace falta «te bendigo» en un agradecimiento). No dice nada de grabaciones (los eventos gratuitos no se graban) ni de grupos. Sin género.",
  },
  {
    id: "danilo-manana-en-la-tarde",
    origin: "Danilo Calderón, 18-oct: aceptó la llamada gratis y pidió «mañana en la tarde»; la tarde estaba llena, la IA le ofreció horas de hoy con «hoy mismo» en una frase y la pregunta en otra, el freno lo tomó por promesa y solo recibió «Ya le paso tu mensaje a Dayana»",
    name: "Danilo Calderon",
    contactName: "Danilo Calderón",
    gender: "m",
    personTimezone: "America/Guayaquil",
    stage: "conversando",
    transcript: [
      person("👍👍muchas gracias"),
      ai("Con gusto. ¿Desde qué país me escribes?"),
      person("Ecuador"),
      ai("¿Qué es lo que más te gustaría transformar o en qué área sientes que estás estancado en este momento, Danilo?"),
      person("Pues tengo sueños aun que cumplir pero miedo a que nada salga como quiero y miedo a las críticas, siempre me ha importado el que dirán"),
      ai("Eso que sientes frena mucho el camino, Danilo. ¿Cuánto tiempo más quieres que ese miedo decida por ti?"),
      person("No más, tengo 48 años, aun creo tener mucho que aportar."),
      ai("Tienes toda la razón, Danilo, a los 48 años hay mucho camino por delante y mucho por aportar. Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso; ella te escucha y te dice cómo te puede ayudar."),
      person("Me encantaría pero puede ser para mañana en la tarde?"),
    ],
    expect: {
      outcome: "reply",
      anyTool: ["offer_free_call_slots"],
      mustMatch: [/\d{1,2}:\d{2}\s[ap]\.\s?m\./i],
      mustNotMatch: [/ya le paso tu mensaje/i],
    },
    goal: "Busca horas con lo que pidió (mañana en la tarde) y le ofrece las que da la agenda, tal cual, preguntándole cuál le sirve. No lo deja sin horas ni inventa otras.",
  },
  {
    id: "cm7-insiste-hoy",
    origin:
      "«CM7 ⚽🥅», 18-oct: pidió la llamada gratis «hoy mismo», la IA le dijo que hoy no había espacio y le ofreció jueves y viernes, insistió («es que es rápido», «necesitaba hablar con ella») y la IA le repitió las mismas horas; Dayana le escribió ella con el enlace de la sesión (pedido de la dueña, 19-oct)",
    name: "CM7 ⚽🥅",
    gender: "unknown",
    personTimezone: "America/Bogota",
    stage: "nueva",
    backing: ["jueves, 22 de octubre, a las 7:00 p. m.", "viernes, 23 de octubre, a las 9:45 p. m."],
    transcript: [
      person("Hola amor"),
      ai("Hola, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"),
      person("Muy bien y tu"),
      ai("Muy bien, con la bendición de Dios. ¿Desde qué país me escribes?"),
      person("Colombia"),
      person("Oye amor"),
      ai("Te bendigo. Estoy muy bien, gracias a Dios."),
      person("Te puedo hacer llamada"),
      ai("Las llamadas se hacen mediante una cita previa con Dayana, sin costo. Si quieres, te agendo una llamada gratis de 15 minutos con ella, sin costo ni compromiso, y te escucha por este medio."),
      person("Si por favor"),
      person("Hoy"),
      person("Mismo"),
      ai("Para hoy ya no tenemos espacios libres en la agenda de Dayana. Te tengo disponibilidad para el jueves, 22 de octubre, a las 7:00 p. m. o el viernes, 23 de octubre, a las 9:45 p. m. ¿Te sirve alguna?"),
      person("Es que es rápido"),
      person("Necesitaba hablar con ella"),
    ],
    expect: {
      outcome: "reply",
      anyTool: ["send_urgent_session_link"],
      mustMatch: [/\/pagar\/p\/therapy-1/, /hoy o mañana/i],
      mustNotMatch: [/jueves|viernes/i, /hoy mismo/i, /te (llama|llamará|atiende|atenderá) hoy/i],
    },
    goal: "Insistió en hablar con Dayana hoy después de que le ofrecieron jueves y viernes: reconoce con calidez que es urgente y le ofrece la sesión privada de 1 hora por Google Meet (el enlace de pago y que Dayana la agenda para hoy o mañana en cuanto pague los pega el sistema debajo). Sin precio, sin repetir las horas del jueves y el viernes, sin prometer que Dayana la llama hoy.",
  },
  {
    id: "naty-ya-no-quiero-sentirme-asi",
    origin:
      "Naty (Perú), 18-oct: la IA le ofreció la llamada gratis, ella contestó «Ya no quiero sentirme así» y la IA se despidió con «Quedamos en contacto»; dijo «Si» y se despidió otra vez (el flujo leyó «no quiero» como un no)",
    name: "Naty  Rodríguez 💕💕🖤🖤🐾🐾",
    gender: "unknown",
    personTimezone: "America/Lima",
    stage: "conversando",
    transcript: [
      person("Hola"),
      ai("Hola, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"),
      person("Mal"),
      ai("Siento que estés así. ¿Desde qué país me escribes?"),
      person("Perú"),
      ai("Gracias. Cuéntame qué situación te trae hoy a buscar este espacio con Dayana."),
      person("No puedo avanzar"),
      ai("Entiendo lo frustrante que es sentir que no puedes avanzar. ¿Cuánto tiempo más quieres seguir sintiéndote así?"),
      person("Siento mucho dolor y miedo"),
      ai("Siento mucho que lleves ese dolor y ese miedo contigo. Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso, para que ella te escuche y te diga cómo te puede ayudar."),
      person("Ya no quiero sentirme así"),
    ],
    expect: {
      outcome: "reply",
      mustNotMatch: [/quedamos en contacto/i, /si en alg[uú]n momento/i],
    },
    goal: "«Ya no quiero sentirme así» es que quiere cambiar, no un no: lo reconoce con calidez y avanza hacia la llamada gratis (le pregunta si la agenda o le ofrece horas). No se despide ni le deja «la puerta abierta».",
  },
  {
    id: "pide-hoy-una-vez",
    origin: "Contraparte de «CM7 ⚽🥅»: pedir «hoy» una sola vez no es insistir (la dueña: «no va a pasar con todos»)",
    name: "CM7 ⚽🥅",
    gender: "unknown",
    personTimezone: "America/Bogota",
    stage: "nueva",
    transcript: [
      person("Hola"),
      ai("Hola, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"),
      person("Bien, quiero hablar con Dayana"),
      ai("Con gusto. ¿Desde qué país me escribes?"),
      person("Colombia"),
      ai("Gracias. Si quieres, te agendo una llamada gratis de 15 minutos con ella, sin costo ni compromiso, y te escucha por este medio."),
      person("Si por favor, puede ser hoy?"),
    ],
    expect: {
      outcome: "reply",
      anyTool: ["offer_free_call_slots"],
      noTool: ["send_urgent_session_link"],
      mustNotMatch: [/pagar\/p\//, /sesi[oó]n privada/i],
    },
    goal: "Pidió hoy por primera vez: le ofrece las horas de la llamada gratis que da la agenda (hoy si hay, si no las más cercanas) y le pregunta cuál le sirve. Todavía no le ofrece la sesión pagada.",
  },
  {
    id: "paola-enlace-de-dayana",
    origin: "Paola Rodriguez, 21-oct: Dayana le mandó el enlace de pago después de la llamada; a su «Si» la IA le mandó la cuenta de Bancolombia",
    name: "☺️",
    contactName: "Paola Rodriguez",
    gender: "unknown",
    personTimezone: "America/Bogota",
    stage: "tuvo_llamada",
    transcript: [
      ai("Quedó agendada tu llamada para el miércoles, 21 de octubre a las 9:30 a. m. hora de Colombia. Dayana te llama por WhatsApp a este número, Paola."),
      person("Perfecto"),
      dayana("Hola Paola, te bendigo buenos días. Te habla Dayana Beltrán,"),
      dayana("🎤 Hermosa, te voy a enviar el link de pago y mi website para que puedas mirar. Estoy como pionera también en Google y quedo superatenta. Te bendigo."),
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-24"),
      ai("Hola Paola, ¿pudiste hablar con Dayana en tu llamada del miércoles, 21 de octubre? Responde SÍ o NO por aquí."),
      person("Si"),
    ],
    expect: {
      outcome: "reply",
      noTool: ["send_urgent_session_link", "offer_free_call_slots"],
      mustNotMatch: [/N° Cuenta|Tipo de cuenta|Documento CC|Western Union/i],
    },
    goal: "Ya habló con Dayana y Dayana le mandó el enlace de pago: le dice que puede hacer el pago por el enlace que le envió Dayana y que mande el comprobante por aquí cuando lo haga. No le manda las cuentas del banco ni le ofrece otra llamada.",
  },
  {
    id: "joselyn-solo-el-enlace",
    origin:
      "Joselyn Jiménez (+503), 21-oct: ya habló con Dayana y recibió los enlaces de 3 y de 6 sesiones; la nota de Dayana dice que no se le agenda nada hasta que pague el paquete de 3. Escribió «Todo los miedos que tengo» / «Por favor» y la IA llevaba 6 días callada (una escalada «clinical» por su angustia la había pausado)",
    name: "Joselyn Jiménez 🪷💞🔧⚙️🔩",
    gender: "f",
    personTimezone: "America/El_Salvador",
    stage: "tuvo_llamada",
    memory:
      "Ya se le ha llamado y ha tenido conversacion pero solo quiere cosas gratis, ya se le envia el link de pago pero nunca paga, es intenza por lo tanto no se le agendan mas llamadas, ni tampoco acompañamiento, hasta que pague el paquete de 3 seciones.",
    transcript: [
      dayana("Te llamaré a esta hora para darte un diagnóstico y darte información de qué paquetes de Terapia necesitas?"),
      dayana("Ya te envío el link de pago el paquete de tres sesiones"),
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-3"),
      dayana("Y ese es el link de pago para el paquete de seis sesiones"),
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-6"),
      person("Como la expresó y no me puede dar una sesión gratis"),
      person("Quítame la angustia de mi hermana"),
      person("Hola llevate"),
      person("Todo los miedos que tengo"),
      person("Por favor"),
    ],
    expect: {
      outcome: "reply",
      anyTool: ["send_payment_link"],
      noTool: ["offer_free_call_slots", "book_free_call", "send_payment_info"],
      mustMatch: [/pagar\/p\/therapy-3/],
      mustNotMatch: [/therapy-6/, /N° Cuenta|Tipo de cuenta|Western Union/i],
    },
    goal: "Ya tuvo la llamada y la nota de Dayana dice que primero pague el paquete de 3 sesiones: con calidez y en corto, le dice que para empezar a trabajar eso con Dayana el paso es el pago del paquete de 3 sesiones por el enlace (el de 3, debajo) y que mande el comprobante por aquí. No le ofrece otra llamada ni sesión gratis, no le da acompañamiento terapéutico por chat, no le manda las cuentas.",
  },
  {
    id: "paola-pide-la-cuenta",
    origin: "Contraparte de «paola-enlace-de-dayana»: con el enlace de Dayana, si pide la cuenta sí se le da",
    name: "☺️",
    contactName: "Paola Rodriguez",
    gender: "unknown",
    personTimezone: "America/Bogota",
    stage: "tuvo_llamada",
    transcript: [
      dayana("🎤 Hermosa, te voy a enviar el link de pago y mi website para que puedas mirar."),
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-24"),
      person("Gracias. ¿Me pasas mejor el número de cuenta? Prefiero hacer transferencia, estoy en Bogotá"),
    ],
    expect: { outcome: "reply", anyTool: ["send_payment_info"] },
    goal: "Pidió la cuenta para transferir: le comparte los datos de pago de Colombia con la herramienta (no escritos a mano), en un mensaje corto, y le pide el comprobante.",
  },
  {
    id: "raquel-ya-hablo-pide-reagendar",
    origin: "Raquel (+34), 19–21 oct: Dayana le mandó Western Union y el valor del paquete; seguía con «llamada gratis» y recordatorios",
    name: "Raquel Torres",
    gender: "f",
    personTimezone: "Europe/Madrid",
    stage: "tuvo_llamada",
    transcript: [
      dayana("OK hermosa, aquí te envío la información de Western Union"),
      person("si gracias"),
      dayana("NOMBRE DE BANCO: BANCO UNIÓN – WESTERN UNION\nEnvío directo a cuenta en Colombia\nNúmero de cuenta: 0000000000\nTitular: Diana Beltrán"),
      dayana("175 USD\n580.000 COP"),
      dayana("PAQUETE DE TRES SESIONES PERSONALIZADAS 1.1"),
      dayana("Un abrazo, pronto me envíes el comprobante iniciamos"),
      person("Gracias bella, si te envío el Western"),
      person("Hola, ¿podemos cambiar la llamada del jueves para otro día? Ese día no puedo"),
    ],
    // Contestar (pagar + comprobante) o pasárselo a Dayana: las dos valen (dueño, 21-oct).
    expect: {
      noTool: ["offer_free_call_slots", "book_free_call", "send_payment_info"],
      mustNotMatch: [/N° Cuenta|Número de cuenta/i],
    },
    goal: "Ya habló de la sesión y los valores con Dayana (Dayana le mandó cómo pagar): no le ofrece ni le reagenda la llamada gratis. Le explica con amabilidad que ya tuvo su llamada con Dayana y que, para empezar sus sesiones, haga el pago con los datos que le mandó Dayana y mande el comprobante por aquí para que Dayana lo verifique y le agende; o le pregunta si tiene alguna dificultad para pagar; o le dice que le avisa a Dayana.",
  },
  {
    id: "carmen-buenos-dias-tras-pago",
    origin: "Carmen, 21-oct: Dayana le mandó su Nequi y el valor; la IA le preguntó «¿Pudiste hablar con Dayana?» y a su «Hola buenos día» le repitió la misma pregunta",
    name: "Carmen Galindo",
    gender: "unknown",
    personTimezone: "America/Bogota",
    stage: "tuvo_llamada",
    transcript: [
      dayana("Hola Carmen, te bendigo buenos días"),
      dayana("Te habla Dayana Beltrán"),
      dayana("OK, mi número de Nequi es 3105833188 a nombre de Diana Bel\n\nPaquete de 6 sesiones"),
      dayana("Quedo atenta, tan pronto me envíes el comprobante de pago, agendamos día y hora que me digas"),
      person("Mil gracias🙏💕"),
      person("Hola buenos dia"),
    ],
    expect: {
      noTool: ["offer_free_call_slots", "book_free_call"],
      mustNotMatch: [/pudiste hablar/i, /llamada gratis/i],
    },
    goal: "Ya habló con Dayana y Dayana le mandó cómo pagar. La saluda corto y, si hace falta, le recuerda que cuando haga el pago mande el comprobante por aquí; o no escribe nada porque le está respondiendo a Dayana. Nunca le pregunta si pudo hablar con Dayana ni le ofrece la llamada gratis.",
  },
  {
    id: "patricia-le-responde-a-dayana",
    origin: "Patricia (Perú), 20-oct: le respondía a una nota de voz de Dayana y la IA contestó «Con gusto, Patricia 🙏» cinco veces",
    name: "Patricia Vergara",
    gender: "f",
    personTimezone: "America/Lima",
    stage: "conversando",
    transcript: [
      ai("Entiendo, Patricia. Los eventos gratuitos con Dayana son en vivo y no quedan grabados, así que te esperamos con mucho gusto si puedes acompañarnos."),
      dayana("🎤 Hola, te bendigo. Bueno, tenemos este evento el día domingo de 9:30 de la mañana a 12:30 del mediodía, pero también vamos a tener otra actividad si quieres seguir aprendiendo: tenemos un curso los días martes."),
      person("Que gusto escucharte Dayana, me encantó escucharte"),
      person("gracias Dayana, lo voy a tener en consideración"),
    ],
    expect: { outcome: "silent" },
    goal: "Le está respondiendo a Dayana (agradece y comenta, sin preguntar nada): la asistente no se mete en esa conversación y no escribe nada.",
  },
  {
    id: "alexandra-en-cita-medica",
    origin: "Alexandra, 21-oct: Dayana le escribió para llamarla, ella contestó que estaba en una cita médica y la IA se metió",
    name: "Alexandra Rivero",
    gender: "f",
    personTimezone: "America/Bogota",
    stage: "llamada_agendada",
    hasBooking: true,
    transcript: [
      ai("Tu llamada con Dayana quedó agendada para el miércoles, 21 de octubre, a las 10:00 a. m. hora de Colombia. Ella te llama por WhatsApp a este número, Alexandra."),
      person("Gracias 🙏"),
      dayana("Hola Alexandra, te bendigo"),
      dayana("Buenos días, te habla Dayana Beltrán"),
      person("Hola doc"),
      person("Estoy en cita de medicina general"),
      person("Ya casi salgo"),
    ],
    expect: { outcome: "silent" },
    goal: "Le está contestando a Dayana, que está en contacto con ella para la llamada: la asistente no se mete ni promete nada; no escribe nada.",
  },
];
