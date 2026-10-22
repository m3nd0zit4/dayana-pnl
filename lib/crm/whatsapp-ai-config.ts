import { z } from "zod";

import { WHATSAPP_COMMUNITY_URL } from "@/lib/contact";

import { getSiteSetting, setSiteSetting } from "./site-settings";
import { clampReminderMinutes, DEFAULT_FREE_CALL_REMINDER } from "./whatsapp-agent/free-call-reminder-rules";
import { DEFAULT_NO_SHOW_MESSAGE } from "./whatsapp-agent/no-show-rules";
import { DEFAULT_URGENT_SESSION_AFTER, DEFAULT_URGENT_SESSION_URL } from "./whatsapp-agent/urgent-session";

/**
 * Cómo se comporta la respuesta automática de WhatsApp. Todo se cambia desde
 * Ajustes → Asistente de WhatsApp; aquí solo vive la forma y los valores por
 * defecto.
 *
 * El interruptor general (encendido / apagado) NO vive aquí: sigue en su
 * propia clave (`whatsapp.autoreply.enabled`) para que apagarlo sea una sola
 * escritura que no pueda romper el resto de la configuración.
 *
 * Este módulo es puro salvo `get`/`set`: sin Prisma ni modelo, para probarlo
 * y para que el cliente importe los tipos.
 */

const CONFIG_KEY = "whatsapp.ai";

/** El curso en vivo en grupo: la opción de pago más económica que hay hoy (oct. 2026). */
export const DEFAULT_AFFORDABLE_OPTIONS = [
  {
    key: "curso-en-vivo",
    label: "Curso en vivo con Dayana: clases en grupo por Google Meet, cupos limitados (más económico que la terapia 1:1)",
    url: "/pagar/p/course-live",
    enabled: true,
  },
];

/** Lo que mueve a buscar ayuda y la pregunta clave para cada cosa (las de Dayana). */
export const DEFAULT_BUY_BUTTONS = [
  { key: "tristeza", label: "Tristeza", keyQuestion: "¿Cuánto tiempo más quieres seguir con esa tristeza?", enabled: true },
  {
    key: "ansiedad",
    label: "Ansiedad",
    keyQuestion: "Si quieres recuperar tu esencia y liberar esa ansiedad, puedes agendar una llamada gratis con Dayana y te ayudamos.",
    enabled: true,
  },
  { key: "autoestima", label: "Autoestima", keyQuestion: "¿Cuánto tiempo más quieres seguir sintiendo que no vales lo suficiente?", enabled: true },
  { key: "pareja", label: "Pareja / relaciones", keyQuestion: "¿Cuánto tiempo más quieres seguir viviendo tu relación así?", enabled: true },
  { key: "dinero", label: "Dinero / bloqueos", keyQuestion: "¿Cuánto tiempo más quieres seguir con esos bloqueos con el dinero?", enabled: true },
  {
    key: "duelo",
    label: "Duelo / pérdida",
    keyQuestion: "Ese dolor se puede sanar. ¿Te gustaría hablarlo con Dayana en una llamada gratis de 15 minutos?",
    enabled: true,
  },
  { key: "miedo", label: "Miedos", keyQuestion: "¿Cuánto tiempo más quieres que ese miedo decida por ti?", enabled: true },
  { key: "soledad", label: "Soledad", keyQuestion: "¿Cuánto tiempo más quieres seguir sintiéndote sola?", enabled: true },
  { key: "estancamiento", label: "Estancamiento", keyQuestion: "¿Cuánto tiempo más quieres seguir sintiéndote estancada?", enabled: true },
];

const hm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora en formato HH:MM");

const bookingSchema = z.object({
  /** Apagado, la IA no agenda: pasa las citas a Dayana (o comparte `bookingUrl`). */
  enabled: z.boolean(),
  /** Cuenta de Google con Calendar. Vacío = la única conectada. */
  accountId: z.string().trim().max(60),
  /** Franjas en que se puede agendar, en la zona operativa (0 = domingo). */
  hours: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        from: hm,
        to: hm,
      })
    )
    .max(21),
  /**
   * Dayana aprueba las horas ANTES de que la IA se las ofrezca a la persona
   * (hay horas libres que no quiere dar). Con default: una configuración vieja
   * sin este campo sigue siendo válida.
   */
  approveSlots: z.boolean().default(true),
  /**
   * La IA busca horas en el calendario y las propone. Apagado (lo normal): la
   * IA le pregunta a la persona qué día y hora le sirven y le avisa a Dayana
   * para que ella agende.
   */
  aiSchedules: z.boolean().default(false),
  /** Minutos libres antes y después de cada cita. */
  bufferMin: z.number().int().min(0).max(120),
  /** Antelación mínima para agendar, en horas. */
  minNoticeHours: z.number().int().min(0).max(168),
  /** Hasta cuántos días hacia adelante ofrece horas. */
  horizonDays: z.number().int().min(1).max(60),
  /** Qué se puede agendar y cuánto dura. La IA elige según la conversación. */
  services: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(80),
        minutes: z.number().int().min(10).max(240),
      })
    )
    .min(1)
    .max(12),
  /** Crea un enlace de Google Meet en cada cita. */
  addMeet: z.boolean(),
});

export type WhatsAppBookingConfig = z.infer<typeof bookingSchema>;

export const whatsAppAiConfigSchema = z.object({
  /**
   * `assistant`: escribe DE PARTE de Dayana, en tercera persona.
   * `owner`: escribe como Dayana, en primera persona. Aun así, si alguien
   * pregunta si es un robot, dice la verdad y pasa el hilo a una persona.
   */
  identity: z.enum(["assistant", "owner"]),
  audience: z.object({
    /** No contesta a su libreta personal: contactos guardados en el celular
     * que no son clientes ni están en el CRM (familia, amigos). */
    skipKnownContacts: z.boolean(),
    /** No contesta a quien ya pagó algo: a un cliente lo atiende ella. */
    skipCustomers: z.boolean(),
  }),
  schedule: z.object({
    /** `outside_hours`: solo contesta cuando Dayana no está atendiendo. */
    mode: z.enum(["always", "outside_hours"]),
    /** Días en que Dayana atiende (0 = domingo). */
    days: z.array(z.number().int().min(0).max(6)).max(7),
    start: hm,
    end: hm,
  }),
  /** Máximo de mensajes automáticos por hilo en 24 h. */
  maxPerDay: z.number().int().min(1).max(20),
  /**
   * Cuando Dayana contesta en un chat, la IA se aparta. Pasadas estas horas
   * sin que ella vuelva a escribir ahí, la IA puede volver a contestar.
   * 0 = nunca vuelve sola (hay que reanudarla a mano).
   */
  handoffHours: z.number().int().min(0).max(168),
  /** Enlace para agendar (página de citas de Google Calendar). Vacío = la
   * IA pasa las citas a Dayana. */
  bookingUrl: z
    .string()
    .trim()
    .max(600)
    .refine(
      (v) => v === "" || /^https:\/\//i.test(v),
      "Debe empezar por https://"
    ),
  /** Instrucciones propias de Dayana: lo que debe saber o evitar. */
  instructions: z.string().trim().max(3000),
  /** Cómo escribe Dayana, en sus palabras (se puede generar desde sus chats). */
  styleGuide: z.string().trim().max(4000),
  learning: z.object({
    /** Usa respuestas reales de Dayana como ejemplos. */
    enabled: z.boolean(),
    /** Cuántos ejemplos parecidos se le dan al modelo en cada respuesta. */
    examples: z.number().int().min(1).max(12),
  }),
  /** A quién avisa cuando pasa un hilo a una persona. */
  notify: z.enum(["ALL", "OWNERS"]),
  /** Cómo arranca un chat nuevo: la IA contesta sola o deja borradores. */
  defaultMode: z.enum(["AUTO", "COPILOT", "MANUAL"]),
  /** Citas directas en el Google Calendar conectado. */
  booking: bookingSchema,
  /**
   * Autoevaluación → WhatsApp: al terminarla, la IA la lee (respuestas, país,
   * hora local) y le escribe a la persona. `requireApproval`: deja el mensaje
   * en la barra de aprobación en vez de enviarlo.
   */
  diagnosticOutreach: z.object({
    enabled: z.boolean(),
    requireApproval: z.boolean(),
  }),
  escalation: z.object({
    /**
     * Lo que se le dice a la persona cuando la IA pasa el chat a Dayana.
     * Vacío = no se le dice nada: la IA se calla y Dayana contesta.
     */
    holdingMessage: z.string().trim().max(300),
  }),
  /**
   * Qué lee la IA de cada chat. `v2`: los últimos `recentMessages` mensajes,
   * sean de cuando sean (antes: 2 semanas o los últimos 40), y la persona es
   * «nueva» solo si de verdad nunca conversó (contando todo el chat).
   */
  context: z.object({
    v2: z.boolean().default(false),
    recentMessages: z.number().int().min(20).max(200).default(60),
    /** Mensajes viejos (fuera de lo que lee) que tocan el mismo tema. */
    snippets: z.number().int().min(0).max(10).default(5),
  }),
  /**
   * Ficha por persona armada con todo su chat (`dossier.ts`): la IA la lee
   * antes de contestar y el reloj la mantiene al día.
   */
  dossier: z.object({
    enabled: z.boolean().default(false),
  }),
  /**
   * Quién atiende a quién (`route.ts`): el modo de cada chat sale del
   * segmento de la persona; el modo general sigue siendo el tope.
   */
  router: z.object({
    enabled: z.boolean().default(false),
    modes: z.object({
      new_lead: z.enum(["AUTO", "COPILOT", "MANUAL"]).default("COPILOT"),
      returning_lead: z.enum(["AUTO", "COPILOT", "MANUAL"]).default("COPILOT"),
      free_call_booked: z.enum(["AUTO", "COPILOT", "MANUAL"]).default("COPILOT"),
      /** Ya tuvo la llamada gratis: Dayana cierra la venta, la IA no le vuelve a ofrecer la llamada. */
      after_call: z.enum(["AUTO", "COPILOT", "MANUAL"]).default("AUTO"),
      client: z.enum(["AUTO", "COPILOT", "MANUAL"]).default("MANUAL"),
      ignored: z.enum(["AUTO", "COPILOT", "MANUAL"]).default("MANUAL"),
    }),
    /**
     * Respuestas automáticas en 24 h para quien no es clienta (nuevas, ya
     * conversó, llamada agendada o tuvo la llamada): necesitan más vueltas.
     * El nombre es de cuando solo valía para las nuevas.
     */
    maxPerDayNewLead: z.number().int().min(1).max(40).default(20),
  }),
  /**
   * El flujo de primera vez (`sales-flow.ts`): saludo como asistente, cómo
   * está, de dónde escribe, lo que la mueve, la pregunta clave y la
   * invitación a la llamada gratis, con horas reales del calendario.
   */
  salesFlow: z.object({
    enabled: z.boolean().default(false),
    /**
     * Lo que mueve a una persona a buscar ayuda (interno: nunca se le nombra
     * así) y la pregunta clave para cada cosa. Lo edita Dayana.
     */
    buyButtons: z
      .array(
        z.object({
          key: z.string().trim().min(2).max(30),
          label: z.string().trim().min(2).max(60),
          keyQuestion: z.string().trim().min(5).max(300),
          enabled: z.boolean().default(true),
        })
      )
      .max(20)
      .default(DEFAULT_BUY_BUTTONS),
  }),
  /**
   * Cuándo se aparta la IA de un chat (`pause-rules.ts`). Apagados (lo pedido
   * por la dueña el 2026-10-14): la IA contesta siempre, salvo a clientas.
   * Lo que pausa Dayana a mano y lo delicado (crisis, urgente) pausa siempre.
   */
  pauses: z.object({
    /** Dayana contesta en un chat: la IA se aparta las horas de relevo (`handoffHours`). */
    onHumanReply: z.boolean().default(false),
    /** La IA le pasa algo a Dayana (un pago, algo que no sabe): se calla en ese chat hasta que la reanuden. */
    onEscalation: z.boolean().default(false),
  }),
  /**
   * Pagos por fuera de la web (`payments.ts`): las cuentas que la asistente
   * comparte cuando se las piden (el texto va tal cual, nunca lo escribe el
   * modelo), si reenvía el enlace de pago que Dayana creó, y si recibe los
   * comprobantes (los mira, le avisa a Dayana y deja el pago listo para
   * confirmar en el CRM).
   */
  payments: z.object({
    methods: z
      .array(
        z.object({
          key: z.string().trim().min(2).max(30),
          /** «Bancolombia», «Western Union – Banco Unión»… */
          label: z.string().trim().min(2).max(60),
          /** A quién va: «Colombia», «Fuera de Colombia», «Solo si lo pide»… */
          when: z.string().trim().max(120).default(""),
          /** El texto exacto que se envía (titular, número de cuenta…). */
          details: z.string().trim().min(5).max(800),
          enabled: z.boolean().default(true),
        })
      )
      .max(8)
      .default([]),
    /** Reenvía el enlace de pago personal que Dayana creó para esa persona. */
    sendLinks: z.boolean().default(true),
    /** Recibe comprobantes: los mira, avisa a Dayana y deja el pago por confirmar. */
    receipts: z.boolean().default(true),
  }),
  /**
   * Limpieza de fotos, audios y videos que llegan por WhatsApp
   * (`media-cleanup.ts`): pasados `keepDays` se borra la copia del store de
   * Blob (el que se llenó y quedó suspendido). El mensaje queda, y la
   * transcripción del audio también. Nunca toca comprobantes de pago, stickers,
   * documentos ni lo que manda Dayana.
   */
  mediaCleanup: z.object({
    enabled: z.boolean().default(false),
    keepDays: z.number().int().min(14).max(365).default(45),
  }),
  /**
   * La comunidad gratis de WhatsApp de Dayana: la asistente manda el enlace
   * cuando la piden («¿me agregas al grupo?») o cuando no les alcanza para la
   * terapia. El enlace lo pega el código, nunca el modelo.
   */
  community: z.object({
    enabled: z.boolean().default(true),
    name: z.string().trim().min(2).max(80).default("Dayana Beltrán - PNL"),
    url: z.string().trim().url().max(300).default(WHATSAPP_COMMUNITY_URL),
  }),
  /**
   * Lo más económico que la asistente ofrece cuando a alguien no le alcanza
   * para la terapia («eso no me alcanza», «primero ahorraré»), además de la
   * comunidad. `url` puede ser una ruta del sitio («/pagar/p/course-live»).
   */
  affordable: z.object({
    enabled: z.boolean().default(true),
    options: z
      .array(
        z.object({
          key: z.string().trim().min(2).max(30),
          /** Lo que la asistente sabe de la opción (sin precio). */
          label: z.string().trim().min(2).max(160),
          url: z.string().trim().min(2).max(300),
          enabled: z.boolean().default(true),
        })
      )
      .max(4)
      .default(DEFAULT_AFFORDABLE_OPTIONS),
  }),
  /** La llamada gratis de 15 minutos (Dayana llama por WhatsApp). */
  freeCall: z.object({
    /**
     * La asistente agenda sola, sin esperar la aprobación de Dayana (solo a
     * personas nuevas o que ya conversaron, con el enrutador y en modo IA).
     */
    autoBook: z.boolean().default(false),
    serviceName: z.string().trim().min(2).max(80).default("Consulta gratis 15 min"),
    /** Llamadas gratis por día como mucho. */
    maxPerDay: z.number().int().min(1).max(20).default(6),
    /** Cuántas horas se ofrecen a la vez. */
    offer: z.number().int().min(2).max(4).default(3),
    /**
     * Si hay espacio hoy o mañana, esas horas van primero (pedido de la dueña,
     * 17-oct). `slots.ts` → `pickFreeCallSlots`.
     */
    soonFirst: z.boolean().default(true),
    /**
     * Los días que Dayana prefiere para la llamada gratis (0 = domingo): se
     * ofrecen después de hoy/mañana y antes que el resto de su horario. Vacío =
     * sin preferencia. Si no hay espacio ahí o la persona no puede, se ofrecen
     * los otros días.
     */
    preferredWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    /**
     * La hora que elige de la lista la agenda el código, sin el modelo («2»,
     * «la primera», «hoy a las 12:45»; `slot-choice.ts`, pedido del dueño
     * 21-oct). Ante la duda sigue el modelo. Solo con «agendar sola».
     */
    controller: z.boolean().default(true),
  }),
  /**
   * Sala de espera de la llamada gratis (`waiting-room.ts`): si la persona
   * escribe a su hora y Dayana sigue en otra reunión, «espérala unos 5
   * minutos». `proactive`: el reloj se lo dice aunque no escriba (solo con la
   * ventana de 24 h abierta).
   */
  waitingRoom: z.object({
    enabled: z.boolean().default(false),
    proactive: z.boolean().default(false),
  }),
  /**
   * Después de la llamada gratis (`call-outcome.ts`): ¿se hizo? Se deduce del
   * chat o se le pregunta a la persona; si no contestó, se le manda el mensaje
   * para reagendar con horas libres.
   */
  callFollowUp: z.object({
    enabled: z.boolean().default(false),
    /** Minutos después de terminar la llamada para revisar el chat (y preguntar). */
    askAfterMin: z.number().int().min(5).max(180).default(10),
    /** Horas sin respuesta a la pregunta para darla por no contestada. */
    assumeMissedAfterHours: z.number().int().min(2).max(72).default(24),
  }),
  /**
   * El seguimiento del cierre (`quote-follow-up.ts`, pedido de la dueña
   * 22-oct): a quien Dayana ya le mandó cómo pagar y no ha pagado, la
   * asistente le escribe a los `firstAfterDays` (o el día siguiente a la
   * fecha que dijo) y otra vez a los `secondAfterDays`; `max` por cotización,
   * solo cotizaciones de los últimos `lookbackDays`. Encendido: lo pidió la
   * dueña («2 seguimientos», «últimos 14 días»). Fuera de las 24 h usa la
   * plantilla «Seguimiento: iniciar el proceso».
   */
  quoteFollowUp: z.object({
    enabled: z.boolean().default(true),
    firstAfterDays: z.number().int().min(1).max(14).default(2),
    secondAfterDays: z.number().int().min(1).max(14).default(4),
    max: z.number().int().min(0).max(3).default(2),
    lookbackDays: z.number().int().min(1).max(30).default(14),
  }),
  /**
   * Recordatorio de la llamada gratis antes de la hora (`free-call-reminder-rules.ts`):
   * «hoy a las … Dayana te llamará por WhatsApp, ten a mano un espacio
   * tranquilo». Encendido por defecto: lo pidió la dueña. Fuera de las 24 h
   * usa la plantilla «Llamada gratis: recordatorio de hoy».
   */
  freeCallReminder: z.object({
    enabled: z.boolean().default(true),
    /** Minutos antes de la llamada. Fuera de 30–180 se ajusta (no tira el bloque). */
    minutesBefore: z.number().transform(clampReminderMinutes).default(60),
    /** Con {{nombre}} y {{hora}}. Vacío = el texto de siempre. */
    message: z.string().trim().max(600).default(DEFAULT_FREE_CALL_REMINDER),
  }),
  /**
   * Sesión pagada sin asistir (`no-show.ts`, pedido de la dueña 17-oct): a los
   * `afterMin` minutos de empezar, si Dayana está en la reunión de Meet y la
   * persona no entró, un mensaje para reagendar. Solo con la API de Meet
   * (Meet activado en la cuenta de Google del calendario): sin ella no sale.
   */
  noShow: z.object({
    enabled: z.boolean().default(true),
    afterMin: z.number().int().min(5).max(30).default(12),
    /** Con {{nombre}} y {{hora}}. */
    message: z.string().trim().max(600).default(DEFAULT_NO_SHOW_MESSAGE),
  }),
  /**
   * Te esperan en la sala (`session-arrival.ts`, pedido de la dueña 19-oct):
   * a la hora de una sesión pagada con Meet, un aviso al celular de Dayana
   * cuando la persona ya entró a la reunión (API de Meet) o escribe que está
   * esperando («ya estoy en la sala», «no me deja entrar»). No le escribe nada
   * a la persona.
   */
  sessionArrival: z.object({
    enabled: z.boolean().default(true),
  }),
  /**
   * La sesión urgente (`urgent-session.ts`, pedido de la dueña 19-oct): a quien
   * insiste en hablar con Dayana hoy, el enlace de pago de la sesión privada de
   * 1 hora; Dayana la agenda para hoy o mañana en cuanto pague. `url` puede ser
   * una ruta del sitio.
   */
  /**
   * Nivel de gasto de la IA (`spend.ts`, pedido de la dueña 19-oct): cuánto
   * del chat lee y cuántas vueltas da con las herramientas. «personalizado»
   * usa `context.recentMessages`, `context.snippets`, `learning.examples` y
   * `maxSteps`. Con `dailyBudgetUsd` (> 0), pasado el tope del día contesta en
   * «ahorro» (nunca se calla).
   */
  spend: z.object({
    level: z.enum(["ahorro", "equilibrado", "completo", "personalizado"]).default("completo"),
    maxSteps: z.number().int().min(3).max(8).default(6),
    dailyBudgetUsd: z.number().min(0).max(100).default(0),
  }),
  urgentSession: z.object({
    enabled: z.boolean().default(true),
    url: z.string().trim().min(2).max(300).default(DEFAULT_URGENT_SESSION_URL),
    /** Lo que va debajo del enlace. */
    afterPayment: z.string().trim().max(300).default(DEFAULT_URGENT_SESSION_AFTER),
  }),
});

export type WhatsAppAiConfig = z.infer<typeof whatsAppAiConfigSchema>;

export const defaultWhatsAppAiConfig = (): WhatsAppAiConfig => ({
  identity: "assistant",
  // Con el número compartido, lo seguro es no hablarle a quien ya conoce a
  // Dayana: su familia no debería recibir una lista de precios.
  audience: { skipKnownContacts: true, skipCustomers: false },
  schedule: {
    mode: "always",
    days: [1, 2, 3, 4, 5],
    start: "08:00",
    end: "18:00",
  },
  maxPerDay: 6,
  handoffHours: 12,
  bookingUrl: "",
  instructions: "",
  styleGuide: "",
  learning: { enabled: true, examples: 10 },
  notify: "ALL",
  defaultMode: "AUTO",
  booking: {
    enabled: true,
    accountId: "",
    hours: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      from: "08:00",
      to: "18:00",
    })),
    approveSlots: true,
    aiSchedules: false,
    bufferMin: 15,
    minNoticeHours: 3,
    horizonDays: 21,
    services: [
      { name: "Consulta gratis 15 min", minutes: 15 },
      { name: "Sesión de terapia", minutes: 60 },
    ],
    addMeet: true,
  },
  diagnosticOutreach: { enabled: true, requireApproval: false },
  escalation: { holdingMessage: "" },
  context: { v2: false, recentMessages: 60, snippets: 5 },
  dossier: { enabled: false },
  router: {
    enabled: false,
    modes: { new_lead: "COPILOT", returning_lead: "COPILOT", free_call_booked: "COPILOT", after_call: "AUTO", client: "MANUAL", ignored: "MANUAL" },
    maxPerDayNewLead: 20,
  },
  pauses: { onHumanReply: false, onEscalation: false },
  payments: { methods: [], sendLinks: true, receipts: true },
  mediaCleanup: { enabled: false, keepDays: 45 },
  community: { enabled: true, name: "Dayana Beltrán - PNL", url: WHATSAPP_COMMUNITY_URL },
  affordable: { enabled: true, options: DEFAULT_AFFORDABLE_OPTIONS },
  salesFlow: { enabled: false, buyButtons: DEFAULT_BUY_BUTTONS },
  freeCall: { autoBook: false, serviceName: "Consulta gratis 15 min", maxPerDay: 6, offer: 3, soonFirst: true, preferredWeekdays: [], controller: true },
  waitingRoom: { enabled: false, proactive: false },
  callFollowUp: { enabled: false, askAfterMin: 10, assumeMissedAfterHours: 24 },
  quoteFollowUp: { enabled: true, firstAfterDays: 2, secondAfterDays: 4, max: 2, lookbackDays: 14 },
  freeCallReminder: { enabled: true, minutesBefore: 60, message: DEFAULT_FREE_CALL_REMINDER },
  noShow: { enabled: true, afterMin: 12, message: DEFAULT_NO_SHOW_MESSAGE },
  sessionArrival: { enabled: true },
  spend: { level: "completo", maxSteps: 6, dailyBudgetUsd: 0 },
  urgentSession: { enabled: true, url: DEFAULT_URGENT_SESSION_URL, afterPayment: DEFAULT_URGENT_SESSION_AFTER },
});

/**
 * Lee la configuración. Lo que falte o no valide cae al valor por defecto
 * campo a campo: una clave nueva en una versión futura no puede apagar la IA
 * ni tirar la configuración que Dayana ya escribió.
 */
export const parseWhatsAppAiConfig = (raw: string | null): WhatsAppAiConfig => {
  const base = defaultWhatsAppAiConfig();
  if (!raw) return base;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!data || typeof data !== "object") return base;

  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base) as (keyof WhatsAppAiConfig)[]) {
    const candidate = (data as Record<string, unknown>)[key];
    if (candidate === undefined) continue;
    const field = whatsAppAiConfigSchema.shape[key].safeParse(candidate);
    if (field.success) merged[key] = field.data;
  }
  return merged as WhatsAppAiConfig;
};

export const getWhatsAppAiConfig = async (): Promise<WhatsAppAiConfig> =>
  parseWhatsAppAiConfig(await getSiteSetting(CONFIG_KEY));

export const setWhatsAppAiConfig = (config: WhatsAppAiConfig): Promise<void> =>
  setSiteSetting(
    CONFIG_KEY,
    JSON.stringify(whatsAppAiConfigSchema.parse(config))
  );

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * ¿Está Dayana en su horario de atención en este momento?
 *
 * Un horario que cruza la medianoche (22:00 → 06:00) cuenta como atendido
 * desde el inicio hasta el final del día siguiente, del día marcado.
 */
export const isWithinOwnerHours = (
  schedule: WhatsAppAiConfig["schedule"],
  now: Date,
  timeZone: string
): boolean => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const day = WEEKDAY[parts.weekday] ?? 0;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const toMin = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const start = toMin(schedule.start);
  const end = toMin(schedule.end);

  if (start === end) return schedule.days.includes(day);
  if (start < end) {
    return schedule.days.includes(day) && minutes >= start && minutes < end;
  }
  // Cruza la medianoche: la parte de la noche es del día marcado y la de la
  // madrugada, del día anterior.
  if (minutes >= start) return schedule.days.includes(day);
  if (minutes < end) return schedule.days.includes((day + 6) % 7);
  return false;
};
