import { getSiteUrl } from "@/lib/site-url";

import { foldForSearch } from "../search-normalize";
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

/** Lo que recibe quien pide entrar a la comunidad si el modelo no le mandó el enlace (va debajo). */
export const COMMUNITY_REPLY = "Claro, aquí puedes unirte a la comunidad de Dayana";

/**
 * Pide entrar a la comunidad o al grupo, o no pudo con el enlace («Quise
 * ingresar al link de Comunidad y no pude», Ruth, 23-oct: una de cada 3 veces
 * el modelo contestaba «Déjame consultarlo con Dayana»).
 */
export const asksToJoinCommunity = (texts: string[]): boolean => {
  const t = foldForSearch(texts.join(" "));
  // «Grupo» solo si es el de Dayana: «me agregan al grupo del curso», «¿el taller es en
  // grupo?», «sáquenme del grupo» no son la comunidad gratis (revisión 23-oct).
  const community = /\bcomunidad\b/.test(t) || /\bgrupo (de dayana|de whatsapp|gratis|gratuito|de superacion|de mensajes)\b/.test(t);
  const other = /\b(curso|taller|clase|clases|meet|zoom|grabacion\w*|pague|compre|sac\w*|salir|no quiero)\b/.test(t);
  return community && !other && /\b(unir\w*|me uno|entrar|entro|ingres\w*|agreg\w*|meter\w*|link|enlace|acceso|no (pude|puedo|me deja))\b/.test(t);
};

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
    `- Si dice que no le alcanza, que está caro, que no tiene cómo pagar, que está mal de plata o que primero va a ahorrar («eso no me alcanza», «no tengo para eso ahora», «estoy mal de plata», «primero ahorraré y luego me inscribo»), también si lo dice de un familiar al que quiere ayudar («mi mamá está mal de plata»): no le ofrezcas espacios gratis aparte de la llamada gratis ni prometas que Dayana la atiende hoy; no insistas con la terapia ni hables de valores. Reconócelo con empatía en una frase y ofrécele lo que sí puede hacer ya: ${offer}. Si todavía no tuvo la llamada gratis con Dayana, recuérdale que esa llamada no tiene costo. Deja la puerta abierta para cuando pueda.`,
    "- Esos enlaces los pega el sistema debajo de tu mensaje: no los escribas tú."
  );
  return `${lines.join("\n")}\n`;
};
