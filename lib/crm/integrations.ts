import { getIntegrationHealth } from "../notifications/health";
import { getSocialConnections } from "./social-accounts";
import { listGoogleAccounts } from "./google-accounts";
import { isGoogleEnabled } from "../google/connect";
import {
  INTEGRATION_CATALOG,
  type IntegrationGroup,
  type IntegrationId,
} from "../integrations/catalog";

/**
 * Resumen de una línea por integración, para la franja de estado en la parte
 * de arriba de `/admin/ajustes/integraciones`.
 *
 * No reemplaza los paneles detallados de abajo (`IntegrationsHealthClient`,
 * `SocialConnectionsClient`, `GoogleAccountsClient`) — cada uno sigue leyendo
 * su propia fuente con su propio vocabulario de estado. Esto solo normaliza
 * los tres a un semáforo común para poder verlos todos de un vistazo.
 */

export type IntegrationOverviewStatus = "ok" | "attention" | "off";

export type IntegrationOverviewItem = {
  id: IntegrationId;
  label: string;
  group: IntegrationGroup;
  status: IntegrationOverviewStatus;
  detail: string;
  /** Para `getIntegrationBrand`: email necesita saber si el activo es Resend o SMTP. */
  requiredEnv: readonly string[];
};

export const getIntegrationsOverview = async (): Promise<
  IntegrationOverviewItem[]
> => {
  const [social, googleAccounts] = await Promise.all([
    getSocialConnections(),
    listGoogleAccounts(),
  ]);

  const items: IntegrationOverviewItem[] = getIntegrationHealth()
    // Google tiene su propia fila más abajo, calculada sobre las cuentas
    // reales conectadas — la de aquí solo diría si el conector está declarado.
    .filter((h) => h.id !== "google")
    .map((h) => ({
      id: h.id,
      label: INTEGRATION_CATALOG[h.id].label,
      group: INTEGRATION_CATALOG[h.id].group,
      status:
        h.status === "ok" ? "ok" : h.status === "degraded" ? "attention" : "off",
      detail: h.detail,
      requiredEnv: h.requiredEnv,
    }));

  for (const connection of social) {
    items.push({
      id: connection.id,
      label: INTEGRATION_CATALOG[connection.id].label,
      group: INTEGRATION_CATALOG[connection.id].group,
      status:
        connection.status === "connected"
          ? "ok"
          : connection.status === "needs_reconnect"
            ? "attention"
            : "off",
      detail: connection.detail,
      requiredEnv: connection.requiredEnv,
    });
  }

  const googleEnabled = isGoogleEnabled();
  const activeGoogle = googleAccounts.filter((a) => a.isActive).length;
  items.push({
    id: "google",
    label: INTEGRATION_CATALOG.google.label,
    group: INTEGRATION_CATALOG.google.group,
    status: !googleEnabled
      ? "off"
      : activeGoogle > 0
        ? "ok"
        : googleAccounts.length > 0
          ? "attention"
          : "off",
    detail: !googleEnabled
      ? "Conector no declarado."
      : `${activeGoogle} de ${googleAccounts.length} cuenta(s) activa(s).`,
    // La marca de Google no depende de ninguna variable puntual.
    requiredEnv: [],
  });

  return items.sort(
    (a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)
  );
};
