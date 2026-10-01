import { getSiteSetting } from "./site-settings";

/**
 * Interruptor de seguridad de las ediciones: «Nuevo evento» y «Duplicar».
 * Encendido por defecto (sin fila). Para apagarlo sin desplegar:
 *
 *   INSERT INTO site_settings (key, value, updated_at)
 *   VALUES ('free_events_editions', 'false', now())
 *   ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = now();
 *
 * Apagado, el panel sigue listando y editando los eventos que ya existen; solo
 * deja de crear nuevos.
 */
export const FREE_EVENTS_EDITIONS_SETTING = "free_events_editions";

export const freeEventEditionsEnabled = async (): Promise<boolean> =>
  (await getSiteSetting(FREE_EVENTS_EDITIONS_SETTING).catch(() => null)) !== "false";
