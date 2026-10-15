import { getSiteUrl } from "@/lib/site-url";

import type { WhatsAppAiConfig } from "../whatsapp-ai-config";

/**
 * La comunidad gratis de WhatsApp y las opciones más económicas que la
 * asistente ofrece. Pedido de la dueña (14-oct-2026): a quien pide entrar a la
 * comunidad se le manda el enlace (antes la IA decía «Dayana te agrega» y lo
 * repitió cuatro veces), y a quien no le alcanza para la terapia se le ofrece
 * la comunidad o el curso. Los enlaces los pega el código, nunca el modelo.
 *
 * Puro: el texto del prompt y los enlaces.
 */

export type AffordableOption = WhatsAppAiConfig["affordable"]["options"][number];

/** Una ruta del sitio («/pagar/p/course-live») con su dominio; una URL completa, tal cual. */
export const absoluteUrl = (url: string): string =>
  /^https?:\/\//i.test(url) ? url : `${getSiteUrl()}${url.startsWith("/") ? "" : "/"}${url}`;

export const communityLink = (config: WhatsAppAiConfig): string | null =>
  config.community.enabled && config.community.url.trim() ? config.community.url.trim() : null;

export const affordableOptions = (config: WhatsAppAiConfig): AffordableOption[] =>
  config.affordable.enabled ? config.affordable.options.filter((o) => o.enabled && o.url.trim()) : [];

/** Las reglas del prompt (nada si no hay comunidad ni opciones). */
export const communityRules = (config: WhatsAppAiConfig): string => {
  const community = communityLink(config);
  const options = affordableOptions(config);
  if (!community && options.length === 0) return "";
  const lines = ["COMUNIDAD Y OPCIONES MÁS ECONÓMICAS:"];
  if (community) {
    lines.push(
      `- Si pide entrar a la comunidad, al grupo o al canal de Dayana (lo vio en TikTok, Instagram…), o pregunta por los mensajes o grupos de superación: usa send_community_link y contesta corto («Claro, aquí puedes unirte a la comunidad de Dayana»). La persona entra con el enlace: no escales ni digas que Dayana la va a agregar.`
    );
  }
  const offer = [
    community && "entrar gratis a la comunidad de Dayana (send_community_link)",
    options.length > 0 &&
      `si quiere avanzar con algo más económico, ${options.map((o) => `${o.label} [${o.key}]`).join("; ")} (send_affordable_option)`,
  ]
    .filter(Boolean)
    .join(" y, ");
  lines.push(
    `- Si dice que no le alcanza, que está caro, que no tiene cómo pagar o que primero va a ahorrar («eso no me alcanza», «no tengo para eso ahora», «primero ahorraré y luego me inscribo»): no insistas con la terapia ni hables de valores. Reconócelo con empatía en una frase y ofrécele lo que sí puede hacer ya: ${offer}. Si todavía no tuvo la llamada gratis con Dayana, recuérdale que esa llamada no tiene costo. Deja la puerta abierta para cuando pueda.`,
    "- Esos enlaces los pega el sistema debajo de tu mensaje: no los escribas tú."
  );
  return `${lines.join("\n")}\n`;
};
