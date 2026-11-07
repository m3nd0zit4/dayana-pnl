import crypto from "node:crypto";

/**
 * Forma de los tokens MCP, sin base de datos (para `bun test`).
 *
 * `dpnl_` + 32 bytes aleatorios en base64url (43 caracteres). En la base solo
 * se guarda el sha256 en hex y el `prefix` (los 12 primeros caracteres, que
 * dicen poco: 7 caracteres aleatorios), para reconocerlo en la lista.
 */

export const MCP_TOKEN_PREFIX = "dpnl_";
export const MCP_TOKEN_PREFIX_LENGTH = 12;
const TOKEN_PATTERN = /^dpnl_[A-Za-z0-9_-]{43}$/;

export const EXPIRY_OPTIONS = [30, 90, 365] as const;
export type ExpiryDays = (typeof EXPIRY_OPTIONS)[number];

export const generateMcpToken = (): string =>
  `${MCP_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;

export const hashMcpToken = (token: string): string =>
  crypto.createHash("sha256").update(token, "utf8").digest("hex");

export const tokenDisplayPrefix = (token: string): string => token.slice(0, MCP_TOKEN_PREFIX_LENGTH);

/** Descarta antes de ir a la base lo que no puede ser un token nuestro. */
export const looksLikeMcpToken = (value: unknown): value is string =>
  typeof value === "string" && TOKEN_PATTERN.test(value);

export const isExpiryDays = (value: unknown): value is ExpiryDays =>
  typeof value === "number" && (EXPIRY_OPTIONS as readonly number[]).includes(value);

/** null = no caduca. */
export const expiryFrom = (days: ExpiryDays | null, now = new Date()): Date | null =>
  days == null ? null : new Date(now.getTime() + days * 24 * 3600_000);

export type McpTokenStatus = "active" | "revoked" | "expired";

export const tokenStatus = (
  token: { revokedAt: Date | null; expiresAt: Date | null },
  now = new Date()
): McpTokenStatus =>
  token.revokedAt ? "revoked" : token.expiresAt && token.expiresAt.getTime() <= now.getTime() ? "expired" : "active";

/** `lastUsedAt` se escribe como mucho una vez por minuto por token. */
export const LAST_USED_THROTTLE_MS = 60_000;

export const shouldTouchLastUsed = (lastUsedAt: Date | null, now = new Date()): boolean =>
  !lastUsedAt || now.getTime() - lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS;
