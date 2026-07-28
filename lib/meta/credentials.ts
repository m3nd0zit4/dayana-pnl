import { prisma } from "@/lib/db";
import { openSecret } from "@/lib/crypto/secret-box";
import { writeAuditLog } from "@/lib/crm/audit";
import { MetaApiError, pageCredentials, type MetaCredentials } from "./client";

/**
 * De dónde salen las credenciales de la Página.
 *
 * Orden: **base de datos primero, entorno después.**
 *
 * La fila de la base es la que el OWNER ve y puede arreglar desde la pantalla
 * de Conexiones, así que manda. El entorno se queda como salida de emergencia:
 * un token de System User pegado en Vercel tiene que seguir funcionando sin
 * tocar código el día que la app de OAuth quede restringida.
 */

export type ResolvedPageCredentials = MetaCredentials & {
  source: "db" | "env";
  socialAccountId: string | null;
  instagramId: string | null;
};

type AccountMetadata = {
  pageId?: string;
  instagramId?: string | null;
};

const readMetadata = (value: unknown): AccountMetadata =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as AccountMetadata)
    : {};

/**
 * Una sola consulta indexada y **ninguna llamada de red**: esto corre en cada
 * envío y en cada adjunto que se rehospeda, así que un `debug_token` aquí
 * pondría una llamada a Meta delante de cada imagen entrante.
 */
export const resolvePageCredentials =
  async (): Promise<ResolvedPageCredentials | null> => {
    const account = await prisma.socialAccount.findFirst({
      where: {
        provider: "FACEBOOK",
        isActive: true,
        accessTokenEnc: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        externalId: true,
        accessTokenEnc: true,
        metadata: true,
      },
    });

    if (account?.accessTokenEnc) {
      try {
        return {
          accountId: account.externalId,
          token: openSecret(account.accessTokenEnc),
          source: "db",
          socialAccountId: account.id,
          instagramId: readMetadata(account.metadata).instagramId ?? null,
        };
      } catch (e) {
        // Un token que no se puede descifrar (AUTH_SECRET rotado) no debe dejar
        // la bandeja muerta si hay respaldo en el entorno.
        console.error("[meta] stored page token could not be decrypted", e);
      }
    }

    const fromEnv = pageCredentials();
    if (!fromEnv) return null;

    return {
      ...fromEnv,
      source: "env",
      socialAccountId: null,
      instagramId: process.env.META_INSTAGRAM_ID?.trim() || null,
    };
  };

/**
 * Marca la conexión como caída cuando Meta responde con un error de permiso.
 *
 * Los tokens de Página derivados de un token de usuario de larga duración no
 * caducan, pero mueren con el de usuario: 60 días, cambio de contraseña o
 * permiso revocado. Meta lo señala todo como código 190.
 */
export const reportPageCredentialFailure = async (
  error: unknown,
  socialAccountId: string
): Promise<void> => {
  if (!(error instanceof MetaApiError) || !error.isAuthError) return;

  const detail = `meta_token_invalid: ${error.message}${
    error.code ? ` (código ${error.code})` : ""
  }`;

  const account = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: { metadata: true },
  });
  const pageId = readMetadata(account?.metadata).pageId;

  // Ambas filas comparten el mismo token, así que las dos caen a la vez.
  await prisma.socialAccount.updateMany({
    where: pageId
      ? { OR: [{ id: socialAccountId }, { externalId: pageId }, { provider: "INSTAGRAM", metadata: { path: ["pageId"], equals: pageId } }] }
      : { id: socialAccountId },
    data: { isActive: false, lastError: detail, lastCheckedAt: new Date() },
  });

  await writeAuditLog({
    action: "SOCIAL_ACCOUNT_INVALIDATED",
    entityType: "SocialAccount",
    entityId: socialAccountId,
    changes: { provider: "FACEBOOK", reason: detail },
  });
};

/**
 * Lo que ve un OPERATOR cuando el token murió.
 *
 * Se le dice a quién pedírselo porque él no puede abrir Ajustes → Conexiones:
 * un "error 190" a secas no es accionable para quien no tiene el permiso.
 */
export const CREDENTIAL_EXPIRED_MESSAGE =
  "La conexión con Meta caducó. Pídele al OWNER que la renueve en Ajustes → Conexiones.";
