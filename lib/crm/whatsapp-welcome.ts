import { z } from "zod";

import { prisma } from "@/lib/db";
import { getSiteSetting, setSiteSetting } from "./site-settings";
import { sendMetaMessage } from "@/lib/meta/send";

/**
 * Saludo automático a quien escribe por primera vez.
 *
 * Es lo primero que ve alguien que llega de un video o de la bio: un mensaje
 * corto y, si Dayana lo configura, un botón que abre su página de citas de
 * Google Calendar. No pasa por el modelo — es un texto
 * fijo que Dayana escribe, y eso es a propósito: el primer mensaje es el que
 * más se lee y el que menos se puede improvisar.
 *
 * Solo en el PRIMER mensaje del hilo. Quien ya escribió antes no vuelve a
 * recibirlo aunque pasen meses: el saludo dos veces delata al robot.
 */

const CONFIG_KEY = "whatsapp.welcome";

export const welcomeConfigSchema = z.object({
  isActive: z.boolean(),
  text: z.string().trim().min(5).max(900),
  /** Vacío = mensaje sin botón, solo texto. */
  buttonLabel: z.string().trim().max(20),
  buttonUrl: z.string().trim().max(600),
});

export type WelcomeConfig = z.infer<typeof welcomeConfigSchema>;

export const defaultWelcomeConfig = (): WelcomeConfig => ({
  isActive: false,
  text: "¡Hola! Gracias por escribir 💛 Cuéntame en qué quieres trabajar y te oriento. Si prefieres, toma tu hora directamente aquí abajo.",
  // Vacíos a propósito: el botón lo enciende Dayana con SU enlace de citas de
  // Google Calendar (Ajustes → Canales). Un botón por defecto hacia una página
  // que no existe es peor que no tener botón.
  buttonLabel: "",
  buttonUrl: "",
});

export const getWelcomeConfig = async (): Promise<WelcomeConfig> => {
  const raw = await getSiteSetting(CONFIG_KEY);
  if (!raw) return defaultWelcomeConfig();
  try {
    const parsed = welcomeConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultWelcomeConfig();
  } catch {
    return defaultWelcomeConfig();
  }
};

export const setWelcomeConfig = (config: WelcomeConfig): Promise<void> =>
  setSiteSetting(CONFIG_KEY, JSON.stringify(config));

/**
 * El botón del saludo. Si Dayana no puso uno propio, usa el enlace para
 * agendar del asistente. Un enlace a la antigua agenda del sitio (ya borrada)
 * se ignora: un botón que lleva a una página que no existe es peor que ninguno.
 */
const resolveButton = async (
  config: WelcomeConfig
): Promise<{ label: string; url: string } | null> => {
  const own =
    config.buttonLabel &&
    config.buttonUrl &&
    !/\/agenda(?:[/?#]|$)/i.test(config.buttonUrl)
      ? { label: config.buttonLabel, url: config.buttonUrl }
      : null;
  if (own) return own;
  const { getWhatsAppAiConfig } = await import("./whatsapp-ai-config");
  const { bookingUrl } = await getWhatsAppAiConfig();
  return bookingUrl
    ? { label: config.buttonLabel || "Agendar mi cita", url: bookingUrl }
    : null;
};

/**
 * Manda el saludo si a este hilo le toca. Devuelve `true` cuando lo envió,
 * para que la respuesta automática no conteste encima en el mismo mensaje.
 *
 * Nunca lanza: corre detrás del webhook de Meta.
 */
export const maybeSendWelcome = async (
  conversationId: string
): Promise<boolean> => {
  try {
    const config = await getWelcomeConfig();
    if (!config.isActive) return false;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        channel: true,
        messages: {
          orderBy: { sentAt: "asc" },
          take: 2,
          select: { direction: true },
        },
      },
    });
    if (!conversation || conversation.channel !== "WHATSAPP") return false;

    // Primer mensaje del hilo, y entrante. Si ya hay dos, o el primero salió
    // de nosotros, este hilo ya tiene historia.
    const [first, second] = conversation.messages;
    if (!first || second || first.direction !== "INBOUND") return false;

    const button = await resolveButton(config);
    const result = await sendMetaMessage({
      conversationId,
      body: config.text,
      ...(button ? { ctaUrl: button } : {}),
    });

    await prisma.conversationMessage.update({
      where: { id: result.messageId },
      data: { isAutoReply: true },
    });

    return true;
  } catch (e) {
    console.error("[whatsapp-welcome] no se pudo saludar", e);
    return false;
  }
};
