/**
 * Configuración de la app de Meta para el enlace por OAuth.
 *
 * Puro entorno, sin red y sin base de datos — igual que `tiktokConfig()`. La
 * pantalla de Conexiones lo llama en render para saber si la app está siquiera
 * registrada.
 */

export type MetaAppConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  /** Configuración de Login for Business; sustituye a `scope`. */
  configId: string | null;
};

/**
 * Permisos que pide la app.
 *
 * Con `config_id` la lista real vive en el panel de Meta; esta constante es la
 * documentación y el respaldo cuando no hay `config_id`. Estar en un único
 * sitio es lo que impide que la revisión de la app y lo que se pide en
 * ejecución se separen.
 */
export const META_CONNECT_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
] as const;

/**
 * Deliberadamente fuera: `business_management` da visibilidad sobre todo el
 * portafolio de negocio y Login for Business suele funcionar sin él cuando la
 * persona es administradora directa de la Página. Se añade solo si
 * `/me/accounts` vuelve vacío.
 */
export const META_CONNECT_OPTIONAL_SCOPES = [
  "pages_read_engagement",
  "business_management",
] as const;

export const META_CONNECT_REQUIRED_ENV = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_LOGIN_CONFIG_ID",
  "NEXT_PUBLIC_SITE_URL",
] as const;

const readEnv = (name: string): string | null =>
  process.env[name]?.trim() || null;

/** Ruta del callback; se muestra en la UI para pegarla tal cual en Meta. */
export const metaRedirectUri = (): string | null => {
  const explicit = readEnv("META_OAUTH_REDIRECT_URI");
  if (explicit) return explicit;

  const site = readEnv("NEXT_PUBLIC_SITE_URL");
  if (!site) return null;
  return `${site.replace(/\/$/, "")}/api/admin/social/meta/callback`;
};

export const metaAppConfig = (): MetaAppConfig | null => {
  const appId = readEnv("META_APP_ID");
  const appSecret = readEnv("META_APP_SECRET");
  const redirectUri = metaRedirectUri();

  if (!appId || !appSecret || !redirectUri) return null;

  return {
    appId,
    appSecret,
    redirectUri,
    configId: readEnv("META_LOGIN_CONFIG_ID"),
  };
};

export const isMetaConnectConfigured = (): boolean => metaAppConfig() !== null;

/**
 * Token de aplicación (`{app-id}|{app-secret}`).
 *
 * Solo para consultas a nivel de app, como leer a qué URL apunta el webhook.
 * Nunca vale para actuar en nombre de una Página.
 */
export const metaAppAccessToken = (): string | null => {
  const config = metaAppConfig();
  return config ? `${config.appId}|${config.appSecret}` : null;
};
