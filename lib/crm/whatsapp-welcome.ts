import { z } from "zod";

import { prisma } from "@/lib/db";
import { getSiteSetting, setSiteSetting } from "./site-settings";
import { sendMetaMessage } from "@/lib/meta/send";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Saludo automático a quien escribe por primera vez.
 *
 * Es lo primero que ve alguien que llega de un video o de la bio: un mensaje
 * corto y un botón que abre la agenda. No pasa por el modelo — es un texto
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
  // WhatsApp corta las etiquetas largas: 20 caracteres es el tope real.
  buttonLabel: "Agendar mi cita",
  buttonUrl: `${getSiteUrl()}/agenda?de=whatsapp`,
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

    const hasButton = Boolean(config.buttonLabel && config.buttonUrl);
    const result = await sendMetaMessage({
      conversationId,
      body: config.text,
      ...(hasButton
        ? { ctaUrl: { label: config.buttonLabel, url: config.buttonUrl } }
        : {}),
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
