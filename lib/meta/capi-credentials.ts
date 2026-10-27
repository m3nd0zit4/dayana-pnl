import {
  deleteSiteSetting,
  getSiteSetting,
  getSiteSettingUpdatedAt,
  setSiteSetting,
} from "../crm/site-settings";
import { openSecret, sealSecret, secretFingerprint } from "../crypto/secret-box";

/**
 * Credenciales de la Conversions API.
 *
 * Mismo criterio que `lib/meta/credentials.ts`: primero la base de datos,
 * y si no hay fila se cae al entorno. Así un token puesto en Vercel sigue
 * funcionando y el CRM puede sobrescribirlo sin desplegar.
 *
 * El token se guarda cifrado (`sealSecret`) aunque viva en `SiteSetting`,
 * que es texto plano: es una credencial de escritura sobre el dataset de
 * anuncios de Dayana, no un ajuste cualquiera.
 */

export const CAPI_TOKEN_SETTING_KEY = "meta_capi_access_token" as const;
export const CAPI_TEST_CODE_SETTING_KEY = "meta_capi_test_event_code" as const;

export type CapiCredentials = {
  pixelId: string;
  token: string;
  /** Solo para Events Manager → Test Events; nunca en producción real. */
  testEventCode?: string;
  source: "db" | "env";
};

/** El id del píxel es público (aparece en el navegador), no es un secreto. */
export const getPixelId = (): string | null =>
  process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || null;

const readSealedSetting = async (key: string): Promise<string | null> => {
  const stored = await getSiteSetting(key);
  if (!stored) return null;
  try {
    return openSecret(stored);
  } catch {
    // Un secreto que no abre casi siempre significa que AUTH_SECRET cambió.
    // Se ignora y se cae al entorno en vez de tumbar el envío.
    console.error("[meta/capi] no se pudo descifrar el token guardado");
    return null;
  }
};

export const resolveCapiCredentials =
  async (): Promise<CapiCredentials | null> => {
    const pixelId = getPixelId();
    if (!pixelId) return null;

    try {
      const fromDb = await readSealedSetting(CAPI_TOKEN_SETTING_KEY);
      if (fromDb) {
        const testEventCode =
          (await getSiteSetting(CAPI_TEST_CODE_SETTING_KEY)) ?? undefined;
        return { pixelId, token: fromDb, testEventCode, source: "db" };
      }
    } catch {
      /* base de datos no disponible: se intenta el entorno */
    }

    const fromEnv = process.env.META_CAPI_ACCESS_TOKEN?.trim();
    if (!fromEnv) return null;

    return {
      pixelId,
      token: fromEnv,
      testEventCode: process.env.META_CAPI_TEST_EVENT_CODE?.trim() || undefined,
      source: "env",
    };
  };

/** `null` borra la fila y devuelve el control al entorno. */
export const setCapiToken = async (token: string | null): Promise<void> => {
  if (token == null || token.trim() === "") {
    await deleteSiteSetting(CAPI_TOKEN_SETTING_KEY);
    return;
  }
  await setSiteSetting(CAPI_TOKEN_SETTING_KEY, sealSecret(token.trim()));
};

/** Para la UI: saber si hay token sin exponerlo. */
export const hasStoredCapiToken = async (): Promise<boolean> =>
  (await getSiteSetting(CAPI_TOKEN_SETTING_KEY)) != null;

export type CapiTokenStatus = {
  /** Sin el id del píxel (`NEXT_PUBLIC_META_PIXEL_ID`) no se envía nada. */
  pixelConfigured: boolean;
  /** De dónde sale el token que se usaría ahora; `null` = ninguno. */
  source: "db" | "env" | null;
  /** 8 caracteres del hash del token, para saber cuál está puesto. Nunca el token. */
  fingerprint: string | null;
  /** Solo cuando `source` es "db". */
  savedAt: string | null;
  /** Hay un token en el servidor aunque el de la base de datos lo tape. */
  envTokenPresent: boolean;
  /**
   * Hay una fila guardada que no se puede descifrar (casi siempre porque
   * cambió `AUTH_SECRET`). El envío la ignora; la pantalla tiene que decirlo
   * en vez de parecer que no hay nada.
   */
  storedUnreadable: boolean;
};

/** Para la pantalla de Ajustes: qué hay puesto, sin revelar el token. */
export const describeCapiToken = async (): Promise<CapiTokenStatus> => {
  const envToken = process.env.META_CAPI_ACCESS_TOKEN?.trim() || null;
  const base = {
    pixelConfigured: getPixelId() !== null,
    envTokenPresent: envToken !== null,
  };

  const fromDb = await readSealedSetting(CAPI_TOKEN_SETTING_KEY);
  const storedUnreadable = !fromDb && (await hasStoredCapiToken());
  if (fromDb) {
    const savedAt = await getSiteSettingUpdatedAt(CAPI_TOKEN_SETTING_KEY);
    return {
      ...base,
      source: "db",
      fingerprint: secretFingerprint(fromDb),
      savedAt: savedAt ? savedAt.toISOString() : null,
      storedUnreadable: false,
    };
  }
  if (envToken) {
    return {
      ...base,
      source: "env",
      fingerprint: secretFingerprint(envToken),
      savedAt: null,
      storedUnreadable,
    };
  }
  return {
    ...base,
    source: null,
    fingerprint: null,
    savedAt: null,
    storedUnreadable,
  };
};
