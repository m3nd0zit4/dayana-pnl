import { isTikTokAudited, tiktokConfig } from "./client";
import { getSiteSettingBoolean, setSiteSettingBoolean } from "@/lib/crm/site-settings";

const SOCIAL_PUBLISHING_OVERRIDE_KEY = "social.publishing.enabled.override";
const TIKTOK_AUDITED_OVERRIDE_KEY = "tiktok.audited.override";

/**
 * Override en BD > `SOCIAL_PUBLISHING_ENABLED`, pero nunca sin credenciales
 * reales: sin `tiktokConfig()` el interruptor quedaría "activado" mostrando
 * una pantalla que no puede conectar nada.
 */
export const resolveSocialPublishingEnabled = async (): Promise<boolean> => {
  let override: boolean | null = null;
  try {
    override = await getSiteSettingBoolean(SOCIAL_PUBLISHING_OVERRIDE_KEY);
  } catch {
    /* DB no disponible */
  }
  const flagOn = override ?? process.env.SOCIAL_PUBLISHING_ENABLED === "true";
  return flagOn && tiktokConfig() !== null;
};

/** Override en BD > `TIKTOK_AUDITED`. `null`/sin fila = automático (entorno). */
export const resolveTiktokAudited = async (): Promise<boolean> => {
  try {
    const override = await getSiteSettingBoolean(TIKTOK_AUDITED_OVERRIDE_KEY);
    if (override != null) return override;
  } catch {
    /* DB no disponible */
  }
  return isTikTokAudited();
};

export const setSocialPublishingOverride = (value: boolean | null): Promise<void> =>
  setSiteSettingBoolean(SOCIAL_PUBLISHING_OVERRIDE_KEY, value);

export const setTiktokAuditedOverride = (value: boolean | null): Promise<void> =>
  setSiteSettingBoolean(TIKTOK_AUDITED_OVERRIDE_KEY, value);

/** Filas crudas (sin fusionar con el entorno), para que la UI distinga "automático" de un override explícito. */
export const getSocialPublishingOverride = (): Promise<boolean | null> =>
  getSiteSettingBoolean(SOCIAL_PUBLISHING_OVERRIDE_KEY);

export const getTiktokAuditedOverride = (): Promise<boolean | null> =>
  getSiteSettingBoolean(TIKTOK_AUDITED_OVERRIDE_KEY);
