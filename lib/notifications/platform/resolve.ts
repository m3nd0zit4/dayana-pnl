import { isDryRun, isNotificationsEnabled } from "../config";
import { getNotificationRuntimeOverrides } from "./site-config";

/**
 * Resolvers async para el camino de envío real. `config.ts` se queda
 * síncrono a propósito (26+ imports lo asumen así); estos leen el override en
 * DB y caen al entorno si no hay fila o si Prisma no responde.
 */

export const resolveNotificationsEnabled = async (): Promise<boolean> => {
  try {
    const { enabledOverride } = await getNotificationRuntimeOverrides();
    if (enabledOverride != null) return enabledOverride;
  } catch {
    /* DB no disponible: cae al valor de entorno */
  }
  return isNotificationsEnabled();
};

export const resolveDryRun = async (): Promise<boolean> => {
  try {
    const { dryRunOverride } = await getNotificationRuntimeOverrides();
    if (dryRunOverride != null) return dryRunOverride;
  } catch {
    /* DB no disponible: cae al valor de entorno */
  }
  return isDryRun();
};
