import { graphGet, graphPost, META_GRAPH_VERSION } from "./client";
import { metaAppAccessToken, metaAppConfig, metaRedirectUri } from "./config";

/**
 * Suscripción de la Página a nuestros webhooks.
 *
 * Esta llamada es la que quita el paso manual del panel de Meta, y cubre
 * Messenger **e** Instagram a la vez: en una cuenta de IG vinculada a la
 * Página, los mensajes de Instagram se entregan por la suscripción de esa
 * misma Página.
 */

/**
 * Solo lo que `lib/meta/inbound.ts` sabe normalizar hoy. Añadir campos aquí es
 * añadir tráfico que luego se descarta en silencio.
 */
export const PAGE_WEBHOOK_FIELDS = ["messages", "messaging_postbacks"] as const;

export type SubscriptionState = {
  subscribed: boolean;
  fields: string[];
  checkedAt: string;
  error?: string;
};

export const subscribePageWebhooks = async (
  pageId: string,
  pageToken: string
): Promise<SubscriptionState> => {
  try {
    await graphPost<{ success?: boolean }>(
      `${pageId}/subscribed_apps`,
      { subscribed_fields: PAGE_WEBHOOK_FIELDS.join(",") },
      { token: pageToken }
    );
    return {
      subscribed: true,
      fields: [...PAGE_WEBHOOK_FIELDS],
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      subscribed: false,
      fields: [],
      checkedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : "subscribe_failed",
    };
  }
};

type SubscribedAppsResponse = {
  data?: { id?: string; subscribed_fields?: string[] }[];
};

export const readPageSubscription = async (
  pageId: string,
  pageToken: string
): Promise<SubscriptionState> => {
  const appId = metaAppConfig()?.appId;
  try {
    const res = await graphGet<SubscribedAppsResponse>(
      `${pageId}/subscribed_apps`,
      { fields: "id,subscribed_fields" },
      { token: pageToken }
    );
    const mine = (res.data ?? []).find((app) => !appId || app.id === appId);
    return {
      subscribed: Boolean(mine),
      fields: mine?.subscribed_fields ?? [],
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      subscribed: false,
      fields: [],
      checkedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : "read_failed",
    };
  }
};

export const unsubscribePageWebhooks = async (
  pageId: string,
  pageToken: string
): Promise<boolean> => {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${pageId}/subscribed_apps`,
      { method: "DELETE", headers: { Authorization: `Bearer ${pageToken}` } }
    );
    return res.ok;
  } catch {
    return false;
  }
};

export type AppSubscriptionDiagnosis = {
  /** URL de callback registrada en la app de Meta. */
  callbackUrl: string | null;
  /** Objetos suscritos a nivel de app (`page`, `instagram`, …). */
  objects: string[];
  /** La URL registrada coincide con la de este despliegue. */
  matchesDeployment: boolean;
  expectedUrl: string | null;
};

type AppSubscriptionsResponse = {
  data?: { object?: string; callback_url?: string; active?: boolean }[];
};

/**
 * Diagnóstico a nivel de app: ¿a qué URL manda Meta los webhooks?
 *
 * Es el fallo silencioso más común: la Página está suscrita, pero la app apunta
 * a un dominio de vista previa antiguo y no llega nada. **Solo lectura**: la
 * suscripción de la app es un ajuste global, y que un despliegue de preview
 * pise la URL de producción deja la bandeja muerta.
 */
export const diagnoseAppSubscription =
  async (): Promise<AppSubscriptionDiagnosis | null> => {
    const config = metaAppConfig();
    const appToken = metaAppAccessToken();
    if (!config || !appToken) return null;

    const expectedUrl = metaRedirectUri()?.replace(
      "/api/admin/social/meta/callback",
      "/api/webhooks/meta"
    ) ?? null;

    try {
      const res = await graphGet<AppSubscriptionsResponse>(
        `${config.appId}/subscriptions`,
        {},
        { token: appToken }
      );
      const rows = res.data ?? [];
      const callbackUrl = rows[0]?.callback_url ?? null;

      return {
        callbackUrl,
        objects: rows.map((r) => r.object ?? "").filter(Boolean),
        matchesDeployment:
          callbackUrl != null &&
          expectedUrl != null &&
          callbackUrl.replace(/\/$/, "") === expectedUrl.replace(/\/$/, ""),
        expectedUrl,
      };
    } catch {
      return { callbackUrl: null, objects: [], matchesDeployment: false, expectedUrl };
    }
  };
