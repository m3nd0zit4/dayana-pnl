/**
 * El modo general (Ajustes) manda: ningún chat puede ser más suelto que él.
 * Si el general es Copiloto, ningún chat —nuevo, creado por un envío masivo o
 * viejo— responde solo; un chat sí puede ser más estricto (Manual).
 */
export type AiMode = "AUTO" | "COPILOT" | "MANUAL";

const STRICTNESS: Record<AiMode, number> = { AUTO: 0, COPILOT: 1, MANUAL: 2 };

export const effectiveAiMode = (chatMode: AiMode, generalMode: AiMode): AiMode =>
  STRICTNESS[chatMode] >= STRICTNESS[generalMode] ? chatMode : generalMode;
