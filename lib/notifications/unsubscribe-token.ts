import crypto from "crypto";

/**
 * Signed, non-expiring token identifying a contact for the one-click
 * unsubscribe link — same throw-if-missing-secret discipline as
 * `lib/social/oauth-state.ts`: an empty signing key would make every forged
 * token verify, silently, only in the misconfigured deployment.
 */
const signingKey = (): string => {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET es obligatorio para firmar el token de baja.");
  }
  return secret;
};

const sign = (contactId: string): string =>
  crypto
    .createHmac("sha256", signingKey())
    .update(contactId)
    .digest("base64url");

export const createUnsubscribeToken = (contactId: string): string =>
  `${contactId}.${sign(contactId)}`;

export const verifyUnsubscribeToken = (token: string | null | undefined): string | null => {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 1) return null;

  const contactId = token.slice(0, i);
  const signature = token.slice(i + 1);
  const expected = sign(contactId);

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  return contactId;
};
