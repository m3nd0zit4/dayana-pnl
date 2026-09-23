import { randomBytes } from "node:crypto";

import { openSecret, sealSecret, secretFingerprint } from "@/lib/crypto/secret-box";
import { getSiteSetting, setSiteSetting } from "@/lib/crm/site-settings";
import {
  DIALOG360_ACCOUNT,
  DIALOG360_HOST,
  whatsAppCredentials,
  type MetaCredentials,
} from "./client";

/**
 * Por dónde sale y entra WhatsApp, elegido desde el CRM.
 *
 * - `meta`: Cloud API directa, con las credenciales del entorno
 *   (`WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`).
 * - `dialog360`: a través de 360dialog, el socio de Meta que permite la
 *   **coexistencia** — el número sigue funcionando en la app de WhatsApp
 *   Business del celular y a la vez en la API. Meta solo ofrece coexistencia a
 *   sus socios, no a un negocio directamente.
 *
 * La clave de 360dialog se guarda **cifrada** (secret-box, AUTH_SECRET): es la
 * llave del WhatsApp del negocio y no puede quedar legible en la base.
 */

const KEY = "whatsapp.provider";

export type WhatsAppProvider = "meta" | "dialog360";

type StoredConfig = {
  provider: WhatsAppProvider;
  /** Clave de 360dialog, cifrada. */
  sealedApiKey?: string | null;
  /**
   * Secreto que 360dialog manda en la cabecera `X-Webhook-Secret` de cada
   * aviso. Lo genera el CRM al registrar el webhook: sin él cualquiera podría
   * inyectar mensajes falsos en la bandeja.
   */
  webhookSecret?: string | null;
};

export type WhatsAppProviderSummary = {
  provider: WhatsAppProvider;
  /** Hay clave de 360dialog guardada. Nunca se devuelve la clave. */
  hasApiKey: boolean;
  /** Huella corta de la clave, para reconocer cuál está puesta. */
  apiKeyFingerprint: string | null;
  webhookRegistered: boolean;
  /** Meta directo tiene credenciales en el entorno. */
  metaEnvConfigured: boolean;
};

const readConfig = async (): Promise<StoredConfig> => {
  const raw = await getSiteSetting(KEY);
  if (!raw) return { provider: "meta" };
  try {
    const parsed = JSON.parse(raw) as StoredConfig;
    return parsed.provider === "dialog360" || parsed.provider === "meta"
      ? parsed
      : { provider: "meta" };
  } catch {
    return { provider: "meta" };
  }
};

const writeConfig = (config: StoredConfig) =>
  setSiteSetting(KEY, JSON.stringify(config));

const openApiKey = (config: StoredConfig): string | null => {
  if (!config.sealedApiKey) return null;
  try {
    return openSecret(config.sealedApiKey);
  } catch {
    return null;
  }
};

export const getWhatsAppProviderSummary =
  async (): Promise<WhatsAppProviderSummary> => {
    const config = await readConfig();
    const apiKey = openApiKey(config);
    return {
      provider: config.provider,
      hasApiKey: Boolean(apiKey),
      apiKeyFingerprint: apiKey ? secretFingerprint(apiKey) : null,
      webhookRegistered: Boolean(config.webhookSecret),
      metaEnvConfigured: whatsAppCredentials() !== null,
    };
  };

/**
 * Cambia de proveedor y, si viene, reemplaza la clave. Una clave vacía no
 * borra la guardada: el formulario no la muestra nunca, y guardar otro campo
 * no puede dejar el WhatsApp sin llave.
 */
export const saveWhatsAppProvider = async (input: {
  provider: WhatsAppProvider;
  apiKey?: string | null;
}): Promise<void> => {
  const current = await readConfig();
  const apiKey = input.apiKey?.trim();
  await writeConfig({
    ...current,
    provider: input.provider,
    ...(apiKey
      ? {
          sealedApiKey: sealSecret(apiKey),
          // Clave nueva, webhook por registrar otra vez.
          webhookSecret: null,
        }
      : {}),
  });
};

/**
 * Credenciales de WhatsApp según el proveedor elegido en el CRM. `null` si el
 * proveedor elegido no tiene con qué conectar.
 */
export const resolveWhatsAppCredentials =
  async (): Promise<MetaCredentials | null> => {
    const config = await readConfig();
    if (config.provider === "dialog360") {
      const apiKey = openApiKey(config);
      return apiKey
        ? { accountId: DIALOG360_ACCOUNT, token: apiKey, provider: "dialog360" }
        : null;
    }
    return whatsAppCredentials();
  };

/** Secreto esperado en los avisos de 360dialog, o `null` si no se registró. */
export const getDialog360WebhookSecret = async (): Promise<string | null> =>
  (await readConfig()).webhookSecret ?? null;

export class Dialog360Error extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const dialog360Fetch = async (
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<unknown> => {
  const res = await fetch(`${DIALOG360_HOST}/${path}`, {
    ...init,
    headers: {
      "D360-API-KEY": apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Dialog360Error(
      res.status === 401
        ? "360dialog rechazó la clave: revisa que esté completa y activa."
        : `360dialog respondió ${res.status}: ${JSON.stringify(body).slice(0, 300)}`,
      res.status
    );
  }
  return body;
};

/** Comprueba que la clave guardada funciona, sin cambiar nada. */
export const testDialog360Connection = async (): Promise<{ webhookUrl: string | null }> => {
  const apiKey = openApiKey(await readConfig());
  if (!apiKey) throw new Dialog360Error("No hay clave de 360dialog guardada.", 400);
  const body = (await dialog360Fetch(apiKey, "v1/configs/webhook")) as { url?: string };
  return { webhookUrl: body.url ?? null };
};

/**
 * A dónde apunta el webhook.
 *
 * En producción, al dominio del sitio. En una Preview de Vercel, a la propia
 * Preview (si no, «Conectar» desde una Preview movería los avisos de
 * producción sin querer) y con la cabecera de «Protection Bypass for
 * Automation»: las Previews están detrás del login de Vercel y 360dialog no
 * podría entrar. `VERCEL_AUTOMATION_BYPASS_SECRET` la pone Vercel sola cuando
 * esa protección está activada en el proyecto.
 */
export const webhookTarget = (
  siteUrl: string
): { base: string; headers: Record<string, string> } => {
  const host = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  if (process.env.VERCEL_ENV === "preview" && host) {
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
    return {
      base: `https://${host}`,
      headers: bypass ? { "x-vercel-protection-bypass": bypass } : {},
    };
  }
  return { base: siteUrl.replace(/\/$/, ""), headers: {} };
};

/**
 * Registra en 360dialog la URL de avisos del CRM con un secreto nuevo en la
 * cabecera. Rotar el secreto en cada registro es lo que permite «volver a
 * conectar» si alguna vez se filtra.
 */
export const registerDialog360Webhook = async (siteUrl: string): Promise<string> => {
  const config = await readConfig();
  const apiKey = openApiKey(config);
  if (!apiKey) throw new Dialog360Error("No hay clave de 360dialog guardada.", 400);

  const secret = randomBytes(24).toString("hex");
  const target = webhookTarget(siteUrl);
  const url = `${target.base}/api/webhooks/whatsapp-360`;
  await dialog360Fetch(apiKey, "v1/configs/webhook", {
    method: "POST",
    body: JSON.stringify({
      url,
      headers: { "X-Webhook-Secret": secret, ...target.headers },
    }),
  });
  await writeConfig({ ...config, webhookSecret: secret });
  return url;
};

/**
 * Pide a WhatsApp que vuelva a mandar el historial de chats de la app (hasta
 * 6 meses) y la libreta de contactos (coexistencia).
 *
 * Meta solo lo entrega una vez y durante las primeras horas después de
 * conectar el número. La primera vez se perdió: llegó cuando el CRM todavía no
 * sabía leerlo. Esto lo vuelve a pedir; si ya pasó el plazo, WhatsApp responde
 * con un error y se muestra tal cual. Lo que llegue entra por el webhook
 * (`history`, `smb_app_state_sync`) y se procesa como siempre.
 */
export const requestDialog360HistorySync = async (): Promise<
  { syncType: string; ok: boolean; detail: string }[]
> => {
  const apiKey = openApiKey(await readConfig());
  if (!apiKey) throw new Dialog360Error("No hay clave de 360dialog guardada.", 400);
  const results: { syncType: string; ok: boolean; detail: string }[] = [];
  for (const syncType of ["smb_app_state_sync", "history"]) {
    try {
      const body = await dialog360Fetch(apiKey, "smb_app_data", {
        method: "POST",
        body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
      });
      results.push({ syncType, ok: true, detail: JSON.stringify(body).slice(0, 300) });
    } catch (e) {
      results.push({
        syncType,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
};
