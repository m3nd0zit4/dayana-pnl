import { prisma } from "@/lib/db";
import { sealSecret } from "@/lib/crypto/secret-box";
import {
  issueOAuthState,
  verifyOAuthState,
  type OAuthDest,
} from "@/lib/social/oauth-state";
import { META_GRAPH_VERSION, MetaApiError } from "./client";
import {
  metaAppConfig,
  META_CONNECT_SCOPES,
  type MetaAppConfig,
} from "./config";

/**
 * Facebook Login for Business.
 *
 * Enlaza la Página y la cuenta de Instagram en un solo paso. Nadie comparte
 * contraseñas: Dayana entra en el dominio de Meta y nos devuelve un permiso
 * sobre los activos que ella elija.
 */

const GRAPH = "https://graph.facebook.com";
const DIALOG = "https://www.facebook.com";

export const buildMetaAuthorizationUrl = (
  staffUserId: string,
  dest: OAuthDest = "x"
): { url: string; state: string; nonce: string } | null => {
  const config = metaAppConfig();
  if (!config) return null;

  const { state, nonce } = issueOAuthState("meta", staffUserId, dest);

  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    state,
    response_type: "code",
  });

  if (config.configId) {
    // Con `config_id` el conjunto de permisos vive en el panel de Meta, así que
    // la revisión de la app y lo que se pide aquí no pueden divergir. Además
    // enseña el selector de activos del negocio en vez del diálogo de consumo.
    params.set("config_id", config.configId);
    params.set("override_default_response_type", "true");
  } else {
    params.set("scope", META_CONNECT_SCOPES.join(","));
  }

  return {
    url: `${DIALOG}/${META_GRAPH_VERSION}/dialog/oauth?${params}`,
    state,
    nonce,
  };
};

export const verifyMetaState = (state: string | null | undefined) =>
  verifyOAuthState("meta", state);

type GraphError = { error?: { message?: string; code?: number; type?: string } };

const graphGetRaw = async <T>(
  path: string,
  params: Record<string, string>
): Promise<T> => {
  const search = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}/${META_GRAPH_VERSION}${path}?${search}`);
  const json = (await res.json().catch(() => ({}))) as T & GraphError;

  if (!res.ok || json.error) {
    throw new MetaApiError(json.error?.message ?? `HTTP ${res.status}`, {
      status: res.status,
      code: json.error?.code,
    });
  }
  return json;
};

type TokenResponse = { access_token: string; expires_in?: number };

/** Código de un solo uso → token de usuario de corta duración (~1 h). */
const exchangeCode = (config: MetaAppConfig, code: string) =>
  graphGetRaw<TokenResponse>("/oauth/access_token", {
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  });

/** Corta duración → larga duración (~60 días). */
const exchangeForLongLived = (config: MetaAppConfig, shortToken: string) =>
  graphGetRaw<TokenResponse>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: config.appId,
    client_secret: config.appSecret,
    fb_exchange_token: shortToken,
  });

type PermissionsResponse = {
  data?: { permission: string; status: string }[];
};

/**
 * Permisos realmente **concedidos**.
 *
 * Se guarda esto y no la lista pedida: si la persona desmarca un activo en el
 * diálogo, la pantalla no puede seguir afirmando que tenemos ese permiso.
 */
const fetchGrantedScopes = async (userToken: string): Promise<string[]> => {
  const res = await graphGetRaw<PermissionsResponse>("/me/permissions", {
    access_token: userToken,
  });
  return (res.data ?? [])
    .filter((p) => p.status === "granted")
    .map((p) => p.permission);
};

export type MetaPage = {
  id: string;
  name?: string;
  username?: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  };
};

const fetchPages = async (userToken: string): Promise<MetaPage[]> => {
  const res = await graphGetRaw<{ data?: MetaPage[] }>("/me/accounts", {
    access_token: userToken,
    fields:
      "id,name,username,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
  });
  return res.data ?? [];
};

const fetchMetaUserId = async (userToken: string): Promise<string | null> => {
  try {
    const res = await graphGetRaw<{ id?: string }>("/me", {
      access_token: userToken,
      fields: "id",
    });
    return res.id ?? null;
  } catch {
    return null;
  }
};

export type MetaConnectionResult =
  | { outcome: "ok"; pageId: string; instagramId: string | null; pageName: string }
  | { outcome: "no_page" }
  | { outcome: "many_pages"; count: number };

/**
 * Ejecuta el intercambio completo y guarda las cuentas.
 *
 * Se escriben DOS filas: una FACEBOOK (Messenger) y, si existe, una INSTAGRAM.
 * Las dos comparten el token de Página porque los mensajes de Instagram salen
 * por el endpoint de la Página; van separadas porque desvincular Instagram de
 * la Página mata Instagram y deja Messenger vivo, y una sola fila no sabría
 * representar eso.
 */
export const completeMetaConnection = async (
  code: string,
  staffUserId: string
): Promise<MetaConnectionResult> => {
  const config = metaAppConfig();
  if (!config) throw new Error("Meta no está configurado.");

  const short = await exchangeCode(config, code);
  const long = await exchangeForLongLived(config, short.access_token);

  const [grantedScopes, pages, metaUserId] = await Promise.all([
    fetchGrantedScopes(long.access_token),
    fetchPages(long.access_token),
    fetchMetaUserId(long.access_token),
  ]);

  if (pages.length === 0) return { outcome: "no_page" };
  // Con el selector de activos de Login for Business esto no debería pasar.
  // Si pasa, no se elige por nosotros: enlazar la Página equivocada es peor que
  // pedir que lo repita.
  if (pages.length > 1) return { outcome: "many_pages", count: pages.length };

  const page = pages[0];
  const instagram = page.instagram_business_account ?? null;
  const scopes = grantedScopes.join(",");

  // El token de Página derivado de uno de usuario de larga duración no caduca;
  // el que sí caduca es el de usuario, y por eso va en `refreshTokenEnc`.
  const pageTokenEnc = sealSecret(page.access_token);
  const userTokenEnc = sealSecret(long.access_token);
  const refreshExpiresAt = long.expires_in
    ? new Date(Date.now() + long.expires_in * 1000)
    : null;

  const sharedMetadata = {
    pageId: page.id,
    instagramId: instagram?.id ?? null,
    metaUserId,
    grantedScopes,
  };

  await prisma.$transaction(async (tx) => {
    const facebook = await tx.socialAccount.upsert({
      where: {
        provider_externalId: { provider: "FACEBOOK", externalId: page.id },
      },
      create: {
        provider: "FACEBOOK",
        externalId: page.id,
        displayName: page.name ?? null,
        username: page.username ?? null,
        avatarUrl: page.picture?.data?.url ?? null,
        accessTokenEnc: pageTokenEnc,
        refreshTokenEnc: userTokenEnc,
        refreshExpiresAt,
        scopes,
        isActive: true,
        lastError: null,
        lastCheckedAt: new Date(),
        connectedByStaffId: staffUserId,
        metadata: { role: "primary", ...sharedMetadata },
      },
      update: {
        displayName: page.name ?? null,
        username: page.username ?? null,
        avatarUrl: page.picture?.data?.url ?? null,
        accessTokenEnc: pageTokenEnc,
        refreshTokenEnc: userTokenEnc,
        refreshExpiresAt,
        scopes,
        isActive: true,
        lastError: null,
        lastCheckedAt: new Date(),
        metadata: { role: "primary", ...sharedMetadata },
      },
      select: { id: true },
    });

    if (instagram) {
      await tx.socialAccount.upsert({
        where: {
          provider_externalId: {
            provider: "INSTAGRAM",
            externalId: instagram.id,
          },
        },
        create: {
          provider: "INSTAGRAM",
          externalId: instagram.id,
          displayName: instagram.name ?? null,
          username: instagram.username ?? null,
          avatarUrl: instagram.profile_picture_url ?? null,
          accessTokenEnc: pageTokenEnc,
          scopes,
          isActive: true,
          lastError: null,
          lastCheckedAt: new Date(),
          connectedByStaffId: staffUserId,
          metadata: {
            role: "linked",
            pageAccountId: facebook.id,
            ...sharedMetadata,
          },
        },
        update: {
          displayName: instagram.name ?? null,
          username: instagram.username ?? null,
          avatarUrl: instagram.profile_picture_url ?? null,
          accessTokenEnc: pageTokenEnc,
          scopes,
          isActive: true,
          lastError: null,
          lastCheckedAt: new Date(),
          metadata: {
            role: "linked",
            pageAccountId: facebook.id,
            ...sharedMetadata,
          },
        },
      });
    }
  });

  return {
    outcome: "ok",
    pageId: page.id,
    instagramId: instagram?.id ?? null,
    pageName: page.name ?? page.id,
  };
};
