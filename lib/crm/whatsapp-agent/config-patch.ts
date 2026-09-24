import {
  getWhatsAppAiConfig,
  setWhatsAppAiConfig,
  whatsAppAiConfigSchema,
  type WhatsAppAiConfig,
} from "../whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled, setWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";

/**
 * Cambios parciales a la configuración del asistente. Los objetos se mezclan
 * por nivel (cambiar `booking.bufferMin` no borra el resto de `booking`); las
 * listas se reemplazan enteras. El resultado se valida completo antes de
 * guardarse: un cambio a medias no puede dejar la IA mal configurada.
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export { diffConfig } from "./config-diff";

export const deepMerge = <T>(base: T, patch: unknown): T => {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = key in base ? deepMerge((base as Record<string, unknown>)[key], value) : value;
  }
  return out as T;
};

export type ConfigPatchResult =
  | { ok: true; config: WhatsAppAiConfig; enabled: boolean; changed: string[] }
  | { ok: false; error: string };

const changedPaths = (before: unknown, after: unknown, prefix = ""): string[] => {
  if (isPlainObject(before) && isPlainObject(after)) {
    return Object.keys(after).flatMap((k) =>
      changedPaths(before[k], after[k], prefix ? `${prefix}.${k}` : k)
    );
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix];
};

export const previewConfigPatch = async (
  patch: unknown
): Promise<ConfigPatchResult & { before?: WhatsAppAiConfig }> => {
  const before = await getWhatsAppAiConfig();
  const merged = deepMerge(before, patch);
  const parsed = whatsAppAiConfigSchema.safeParse(merged);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return {
    ok: true,
    before,
    config: parsed.data,
    enabled: await isWhatsAppAutoReplyEnabled(),
    changed: changedPaths(before, parsed.data),
  };
};

export const applyConfigPatch = async (
  patch: unknown,
  enabled?: boolean
): Promise<ConfigPatchResult> => {
  const preview = await previewConfigPatch(patch ?? {});
  if (!preview.ok) return preview;
  await setWhatsAppAiConfig(preview.config);
  if (enabled !== undefined) await setWhatsAppAutoReplyEnabled(enabled);
  return {
    ok: true,
    config: preview.config,
    enabled: enabled ?? preview.enabled,
    changed: preview.changed,
  };
};
