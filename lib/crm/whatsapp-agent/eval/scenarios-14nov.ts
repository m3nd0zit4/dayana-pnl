import type { Scenario } from "./scenarios";

/**
 * Casos del 14-nov (dueña: «reevalúa todos los casos… cada caso hipotético posible»):
 * otro idioma, zonas de otros países, una hora exacta, la hora con punto, la pregunta
 * de qué horarios hay y un perfil que no es un nombre. Salen de la auditoría de los
 * chats que tuvo que contestar Dayana (Manuel, Silvia, Ale, Yaqueline, «la negra bella»).
 */
type Line = Scenario["transcript"][number];
const ai = (body: string): Line => ({ direction: "OUTBOUND", body, isAutoReply: true });
const person = (body: string): Line => ({ direction: "INBOUND", body, attachment: null });

const LIST_15_OCT = [
  "Estas son las horas libres de Dayana para tu llamada gratis de 15 minutos",
  "",
  "1. Jueves, 15 de octubre, 3:00 p. m.",
  "2. Jueves, 15 de octubre, 6:45 p. m.",
  "",
  "¿Cuál te queda mejor? Puedes responderme con el número.",
].join("\n");

export const SCENARIOS_14NOV: Scenario[] = [
  {
    id: "ingles-pregunta-precio",
    origin: "Caso hipotético (dueña, 14-nov: si escribe en otro idioma, contestarle en su idioma y decirle que Dayana trabaja en español)",
    name: "Jennifer",
    phone: "13055551234",
    transcript: [person("Hi! I saw Dayana's live. How much does a session cost? I live in Miami")],
    expect: {
      outcome: "reply",
      mustMatch: [/spanish/i],
      mustNotMatch: [/\$\s?\d|\busd\b|\d{2,3}\.000/i, /\b(hola|te bendigo|cu[aá]nto)\b/i],
    },
    goal: "Contesta en INGLÉS: se presenta como asistente de Dayana, dice que los valores se los explica Dayana en la llamada gratis de 15 minutos y que Dayana atiende en español. Sin precios. Una sola pregunta para avanzar.",
  },
  {
    id: "portugues-quiere-agendar",
    origin: "Caso hipotético (dueña, 14-nov: otro idioma)",
    name: "Mariana",
    phone: "5511987654321",
    transcript: [person("Olá! Sou de São Paulo, Brasil. Quero agendar uma conversa com a Dayana, quando ela pode?")],
    expect: { outcome: "reply", mustMatch: [/espanhol|espa[nñ]ol/i] },
    goal: "Contesta en PORTUGUÉS, le dice que Dayana atiende en español y avanza a la llamada gratis (horas reales con la hora de São Paulo y la de Colombia, o una sola pregunta necesaria). Nunca horas inventadas.",
  },
  {
    id: "venezuela-pregunta-que-dias",
    origin: "Manuel (+58), 14-nov: «Venezuela ustedes estan en Colombia o donde», luego «De que dia de la semana se puede»; le dijeron «de lunes a sábado» sin horas y después «las 7 de Colombia son las 7 de Venezuela»",
    name: "molinamanu537",
    phone: "584126847305",
    transcript: [
      person("Holaaaaa doctora cómo estás saludos soy Manuel"),
      ai("Hola Manuel, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"),
      person("Muy bien estoy viendo live pues yo quería saber cuánto cuesta una reprogramación"),
      ai("Cada proceso se ajusta a lo que necesitas y Dayana te explica las opciones y los valores en la consulta gratis de 15 minutos. Si quieres, te agendo una llamada gratis con ella. ¿Desde qué país me escribes?"),
      person("Venezuela ustedes estan en Colombia o donde"),
      ai("Sí, Manuel, Dayana está en Colombia. ¿Te agendo la llamada gratis?"),
      person("De que dia de la semana se puede"),
    ],
    expect: {
      outcome: "reply",
      anyTool: ["offer_free_call_slots"],
      mustMatch: [/tu hora/i, /colombia/i],
      mustNotMatch: [/de lunes a s[aá]bado/i],
    },
    goal: "Le da horas reales de la agenda con la hora de Venezuela y la de Colombia (Venezuela va una hora adelante). No le pregunta «¿qué día prefieres?» en el aire ni le dice que la hora es la misma.",
  },
  {
    id: "chile-hora-exacta",
    origin: "Silvia y Ale, 14-nov: pidieron una hora exacta («tipo 3 de la tarde», «exactamente a las 12 hora de mi país») y les salieron otras",
    name: "Paula",
    phone: "56912345678",
    transcript: [
      person("Hola, quiero agendar la llamada gratis con Dayana. Soy de Santiago de Chile"),
      ai("Hola Paula, te bendigo. Soy la asistente de Dayana. Con gusto te agendo la llamada gratis de 15 minutos."),
      person("Mañana jueves a las 5 de la tarde hora de Chile puede ser?"),
    ],
    expect: { outcome: "reply", anyTool: ["offer_free_call_slots", "book_free_call"], mustMatch: [/5:00\s?p\.\s?m\./i, /colombia/i] },
    goal: "Le ofrece (o le agenda) el jueves a las 5:00 p. m. de Chile, que son las 3:00 p. m. de Colombia, diciendo las dos horas. No otra hora ni otro día.",
  },
  {
    id: "elige-con-punto",
    origin: "Silvia, 14-nov: contestó a la lista «18.30, 6.30 sería» y no se agendó",
    name: "Silvia",
    personTimezone: "America/Bogota",
    backing: ["jueves, 15 de octubre, 3:00 p. m.", "jueves, 15 de octubre, 6:45 p. m."],
    transcript: [person("Sí, quiero la llamada"), ai(LIST_15_OCT), person("18.45, 6.45 sería")],
    expect: { outcome: "reply", anyTool: ["book_free_call"] },
    goal: "Agenda el jueves 15 a las 6:45 p. m. (la opción 2) y lo confirma con el día y la hora.",
  },
  {
    id: "pregunta-que-horarios-tienes",
    origin: "Auditoría 14-nov: a «¿qué horarios tienes?» la IA preguntaba «¿qué día y franja te queda mejor?» en vez de dar horas",
    name: "Yaqueline",
    personTimezone: "America/Bogota",
    transcript: [
      person("Hola, buenas tardes"),
      ai("Hola Yaqueline, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"),
      person("Bien, quiero hablar con Dayana sobre mi ansiedad. Soy de Cali"),
      ai("Siento que estés pasando por eso. Si quieres, te agendo una llamada gratis de 15 minutos con Dayana para que te escuche."),
      person("Si, que horarios tienes?"),
    ],
    expect: { outcome: "reply", anyTool: ["offer_free_call_slots"] },
    goal: "Le da las horas libres reales de la agenda (lista numerada), sin preguntarle primero qué día prefiere.",
  },
  {
    id: "taller-dice-bogota",
    origin: "«psicología», 14-nov: preguntó el valor del taller, la IA le ofreció la llamada y preguntó el país; contestó «Bogotá», el modelo escribió horas suyas («8:30p, 9:00p»), el freno las paró y solo le llegó «Déjame revisar la agenda»",
    name: "psicología",
    transcript: [
      person("Hola Dayana, quisiera saber qué valor tiene el taller del día de mañana"),
      ai(
        "Hola, te bendigo. Soy la asistente de Dayana. Con gusto te doy toda la información del taller Sana Tu Relación con el Dinero, que será el día de mañana de 8:30 a. m. a 4:30 p. m. de forma virtual. Es una jornada en vivo por Google Meet para trabajar en conciencia, reprogramación de creencias y programación de futuro. Las inscripciones están abiertas y son con una llamada con Dayana, una sesión personalizada donde te cuenta todo del taller. ¿Desde qué país nos escribes?"
      ),
      person("Bogotá"),
    ],
    expect: { outcome: "reply", anyTool: ["offer_free_call_slots"], mustNotMatch: [/d[eé]jame revisar|d[eé]jame consultarlo/i] },
    goal: "Le da las horas libres reales de la agenda para la llamada con Dayana (lista numerada), sin «déjame revisar la agenda» y sin precio ni enlace del taller.",
  },
  {
    id: "perfil-la-negra-bella",
    origin: "Auditoría 14-nov: «la negra bella» recibió «Hola La»",
    name: "la negra bella",
    transcript: [person("Hola buenas, quisiera información de las sesiones")],
    expect: { outcome: "reply", mustNotMatch: [/\bHola,? La\b/] },
    goal: "Saluda sin nombre (el perfil no es un nombre), se presenta como asistente de Dayana y pregunta con quién tiene el gusto o cómo está.",
  },
];
