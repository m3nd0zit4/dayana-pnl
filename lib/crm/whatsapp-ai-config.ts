import { z } from "zod";

import { getSiteSetting, setSiteSetting } from "./site-settings";

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
  escalation: z.object({
    /**
     * Lo que se le dice a la persona cuando la IA pasa el chat a Dayana.
     * Vacío = no se le dice nada: la IA se calla y Dayana contesta.
     */
    holdingMessage: z.string().trim().max(300),
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
    bufferMin: 15,
    minNoticeHours: 3,
    horizonDays: 21,
    services: [
      { name: "Consulta gratis 15 min", minutes: 15 },
      { name: "Sesión de terapia", minutes: 60 },
    ],
    addMeet: true,
  },
  escalation: { holdingMessage: "" },
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
