import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { effectiveAiMode, type AiMode } from "./mode";
import type { Segment, SegmentVerdict } from "./segment";

/**
 * Quién atiende cada chat: la IA sola, la IA con copiloto, o Dayana.
 *
 * Con el enrutador encendido (`router.enabled`), el modo sale del segmento de
 * la persona (`router.modes`: nuevas en IA, clientas con Dayana…), salvo que
 * Dayana haya elegido un modo para ESE chat (`aiModeOverride`). El modo
 * general de Ajustes es el tope: ningún chat es más suelto que él.
 *
 * Antes el modo más estricto se guardaba en el chat y se quedaba pegado: con
 * el general en Copiloto un rato, todos los chats que escribieron quedaron en
 * Copiloto para siempre. Ahora no se guarda nada: se calcula cada vez.
 *
 * Con el enrutador apagado, todo sigue como antes (`effectiveAiMode`).
 */

const STRICTNESS: Record<AiMode, number> = { AUTO: 0, COPILOT: 1, MANUAL: 2 };

export const strictest = (...modes: AiMode[]): AiMode =>
  modes.reduce((a, b) => (STRICTNESS[b] > STRICTNESS[a] ? b : a), "AUTO" as AiMode);

/** Por qué no contesta (el mismo texto que el rastro de la IA): `customer` abre «Te toca», `ignored_segment` no. */
export type RouteSkip = "manual" | "customer" | "ignored_segment";

export type RouteDecision = {
  routerEnabled: boolean;
  mode: AiMode;
  segment: Segment | null;
  /** Si `mode` es MANUAL, la razón del rastro. */
  skip: RouteSkip | null;
};

export const decideRoute = (input: {
  routerEnabled: boolean;
  generalMode: AiMode;
  /** `Conversation.aiMode` (lo que se usaba antes del enrutador). */
  chatMode: AiMode;
  /** Lo que eligió Dayana para este chat; null = lo decide el segmento. */
  override: AiMode | null;
  segment: SegmentVerdict | null;
  modes: Record<Segment, AiMode>;
}): RouteDecision => {
  if (!input.routerEnabled) {
    const mode = effectiveAiMode(input.chatMode, input.generalMode);
    return { routerEnabled: false, mode, segment: null, skip: mode === "MANUAL" ? "manual" : null };
  }
  const segment = input.segment?.segment ?? null;
  const base = input.override ?? (segment ? input.modes[segment] : input.generalMode);
  const mode = strictest(input.generalMode, base);
  let skip: RouteSkip | null = null;
  if (mode === "MANUAL") {
    skip =
      input.override === "MANUAL" || input.generalMode === "MANUAL"
        ? "manual"
        : segment === "client"
          ? "customer"
          : segment === "ignored"
            ? "ignored_segment"
            : "manual";
  }
  return { routerEnabled: true, mode, segment, skip };
};

/** Tope de respuestas automáticas en 24 h: las nuevas necesitan más vueltas hasta agendar. */
export const maxPerDayFor = (config: WhatsAppAiConfig, segment: Segment | null): number =>
  config.router.enabled && segment === "new_lead" ? Math.max(config.maxPerDay, config.router.maxPerDayNewLead) : config.maxPerDay;
