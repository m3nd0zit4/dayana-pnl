import type { Prisma, SocialProvider } from "@prisma/client";
import { prisma } from "../db";
import { writeAuditLog } from "./audit";
import { openSecret } from "../crypto/secret-box";
import {
  isMetaConnectConfigured,
  metaRedirectUri,
  META_CONNECT_REQUIRED_ENV,
} from "../meta/config";
import { unsubscribePageWebhooks } from "../meta/subscriptions";
import { isTikTokEnabled } from "../tiktok/client";

/**
 * Estado de las cuentas enlazadas, para la pantalla de Conexiones.
 *
 * Es el gemelo con base de datos de `getIntegrationHealth()`. Vive aparte
 * porque aquel es puro entorno a propósito — la página de Integraciones lo
 * llama en render sin await — y esa promesa no se rompe aquí.
 */

export type SocialConnectionStatus =
  | "connected"
  | "needs_reconnect"
  | "not_connected"
  /** La app del proveedor todavía no está registrada en su consola. */
  | "app_not_configured";

export type ConnectedAccountView = {
  provider: SocialProvider;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  scopes: string[];
  connectedAt: string;
  /** Calculado en el servidor: hacerlo en el cliente rompe la hidratación. */
  expiresInDays: number | null;
  expiresAt: string | null;
  lastError: string | null;
  connectedByName: string | null;
  isActive: boolean;
};

export type SocialConnection = {
  id: "meta" | "tiktok";
  label: string;
  description: string;
  status: SocialConnectionStatus;
  detail: string;
  /**
   * Nombre exacto de cada variable que falta. Vive aquí y no en el JSX por lo
   * mismo que en `lib/notifications/health.ts`: si la UI los escribe a mano, el
   * día que cambien la pantalla miente y nadie se entera.
   */
  requiredEnv: readonly string[];
  enables: string;
  /** Null cuando la app no está configurada: sin botón, no un botón muerto. */
  connectHref: string | null;
  /** URI de callback a registrar en la consola del proveedor. */
  redirectUri: string | null;
  accounts: ConnectedAccountView[];
  webhook: { subscribed: boolean; fields: string[]; checkedAt: string | null } | null;
};

const accountSelect = {
  id: true,
  provider: true,
  displayName: true,
  username: true,
  avatarUrl: true,
  scopes: true,
  isActive: true,
  lastError: true,
  refreshExpiresAt: true,
  expiresAt: true,
  createdAt: true,
  metadata: true,
  connectedByStaff: { select: { displayName: true } },
} satisfies Prisma.SocialAccountSelect;

type AccountRow = Prisma.SocialAccountGetPayload<{ select: typeof accountSelect }>;

const daysUntil = (date: Date | null): number | null =>
  date ? Math.floor((date.getTime() - Date.now()) / 86_400_000) : null;

const toAccountView = (row: AccountRow): ConnectedAccountView => {
  // Para Meta lo que caduca es el token de usuario (`refreshExpiresAt`); el de
  // Página no caduca por sí solo. Para TikTok manda `expiresAt`.
  const expiry =
    row.provider === "TIKTOK" ? row.expiresAt : row.refreshExpiresAt;

  return {
    provider: row.provider,
    displayName: row.displayName,
    username: row.username,
    avatarUrl: row.avatarUrl,
    scopes: row.scopes?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
    connectedAt: row.createdAt.toISOString(),
    expiresInDays: daysUntil(expiry),
    expiresAt: expiry?.toISOString() ?? null,
    lastError: row.lastError,
    connectedByName: row.connectedByStaff?.displayName ?? null,
    isActive: row.isActive,
  };
};

type WebhookMetadata = {
  webhook?: { subscribed?: boolean; fields?: string[]; checkedAt?: string };
};

const readWebhook = (value: unknown) => {
  const metadata =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as WebhookMetadata)
      : {};
  if (!metadata.webhook) return null;
  return {
    subscribed: metadata.webhook.subscribed ?? false,
    fields: metadata.webhook.fields ?? [],
    checkedAt: metadata.webhook.checkedAt ?? null,
  };
};

const statusFor = (
  appConfigured: boolean,
  accounts: ConnectedAccountView[]
): SocialConnectionStatus => {
  if (!appConfigured) return "app_not_configured";
  if (accounts.length === 0) return "not_connected";
  // Basta con que una caiga: si Instagram murió, la conexión no está sana.
  return accounts.every((a) => a.isActive) ? "connected" : "needs_reconnect";
};

const TIKTOK_REQUIRED_ENV = [
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "SOCIAL_PUBLISHING_ENABLED",
] as const;

/** Una sola consulta, sin red, y nunca lee las columnas de token. */
export const getSocialConnections = async (): Promise<SocialConnection[]> => {
  const rows = await prisma.socialAccount.findMany({
    orderBy: { createdAt: "asc" },
    select: accountSelect,
  });

  const meta = rows.filter(
    (r) => r.provider === "FACEBOOK" || r.provider === "INSTAGRAM"
  );
  const tiktok = rows.filter((r) => r.provider === "TIKTOK");

  const metaAccounts = meta.map(toAccountView);
  const tiktokAccounts = tiktok.map(toAccountView);
  const metaConfigured = isMetaConnectConfigured();

  const facebookRow = meta.find((r) => r.provider === "FACEBOOK");

  return [
    {
      id: "meta",
      label: "Meta — Página de Facebook e Instagram",
      description:
        "Enlaza la Página y la cuenta de Instagram para recibir y responder mensajes desde la bandeja.",
      status: statusFor(metaConfigured, metaAccounts),
      detail: metaConfigured
        ? metaAccounts.length === 0
          ? "Sin cuentas enlazadas todavía."
          : metaAccounts.every((a) => a.isActive)
            ? "Página e Instagram enlazados."
            : "Alguna cuenta perdió el permiso. Vuelve a conectar."
        : "Falta registrar la app en developers.facebook.com.",
      requiredEnv: META_CONNECT_REQUIRED_ENV,
      enables: "Bandeja de entrada de Instagram y Messenger.",
      connectHref: metaConfigured ? "/api/admin/social/meta/connect" : null,
      redirectUri: metaRedirectUri(),
      accounts: metaAccounts,
      webhook: facebookRow ? readWebhook(facebookRow.metadata) : null,
    },
    {
      id: "tiktok",
      label: "TikTok",
      description:
        "Enlaza la cuenta para programar y publicar vídeos desde el CRM.",
      status: statusFor(isTikTokEnabled(), tiktokAccounts),
      detail: isTikTokEnabled()
        ? tiktokAccounts.length === 0
          ? "Sin cuenta enlazada todavía."
          : tiktokAccounts.every((a) => a.isActive)
            ? "Cuenta enlazada."
            : "La autorización caducó. Vuelve a conectar."
        : "Falta registrar la app en developers.tiktok.com.",
      requiredEnv: TIKTOK_REQUIRED_ENV,
      enables: "Programación y publicación de contenido.",
      connectHref: isTikTokEnabled()
        ? "/api/admin/social/tiktok/connect?dest=x"
        : null,
      redirectUri:
        process.env.TIKTOK_REDIRECT_URI?.trim() ||
        (process.env.NEXT_PUBLIC_SITE_URL?.trim()
          ? `${process.env.NEXT_PUBLIC_SITE_URL.trim().replace(/\/$/, "")}/api/admin/social/tiktok/callback`
          : null),
      accounts: tiktokAccounts,
      webhook: null,
    },
  ];
};

/**
 * Desconecta, sin borrar.
 *
 * `SocialPost.account` es `onDelete: Cascade`, así que borrar la fila se
 * llevaría el historial de publicaciones. Se anulan los tokens y se marca
 * inactiva; reconectar revive la misma fila con sus publicaciones intactas.
 */
const deactivate = (where: Prisma.SocialAccountWhereInput) =>
  prisma.socialAccount.updateMany({
    where,
    data: {
      isActive: false,
      accessTokenEnc: null,
      refreshTokenEnc: null,
      expiresAt: null,
      refreshExpiresAt: null,
      lastError: "disconnected_by_owner",
      lastCheckedAt: new Date(),
    },
  });

export const disconnectMetaConnection = async (
  staffUserId: string
): Promise<{ webhookUnsubscribed: boolean }> => {
  const facebook = await prisma.socialAccount.findFirst({
    where: { provider: "FACEBOOK" },
    select: { id: true, externalId: true, accessTokenEnc: true },
  });

  let webhookUnsubscribed = false;
  if (facebook?.accessTokenEnc) {
    // Best effort: si el token ya está muerto no se puede desuscribir, y eso no
    // puede impedir desconectar.
    try {
      webhookUnsubscribed = await unsubscribePageWebhooks(
        facebook.externalId,
        openSecret(facebook.accessTokenEnc)
      );
    } catch {
      webhookUnsubscribed = false;
    }
  }

  await deactivate({ provider: { in: ["FACEBOOK", "INSTAGRAM"] } });

  await writeAuditLog({
    staffUserId,
    action: "SOCIAL_ACCOUNT_DISCONNECTED",
    entityType: "SocialAccount",
    entityId: facebook?.id ?? "meta",
    changes: { provider: "META", webhookUnsubscribed },
  });

  return { webhookUnsubscribed };
};

export const disconnectTikTokConnection = async (staffUserId: string) => {
  const account = await prisma.socialAccount.findFirst({
    where: { provider: "TIKTOK" },
    select: { id: true },
  });

  await deactivate({ provider: "TIKTOK" });

  await writeAuditLog({
    staffUserId,
    action: "SOCIAL_ACCOUNT_DISCONNECTED",
    entityType: "SocialAccount",
    entityId: account?.id ?? "tiktok",
    changes: { provider: "TIKTOK" },
  });
};

/** Guarda el estado de la suscripción tras (re)intentarla. */
export const saveWebhookState = async (
  pageExternalId: string,
  webhook: { subscribed: boolean; fields: string[]; checkedAt: string; error?: string }
) => {
  const row = await prisma.socialAccount.findFirst({
    where: { provider: "FACEBOOK", externalId: pageExternalId },
    select: { id: true, metadata: true },
  });
  if (!row) return;

  const previous =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  await prisma.socialAccount.update({
    where: { id: row.id },
    data: { metadata: { ...previous, webhook } as Prisma.InputJsonValue },
  });
};
