import { NextResponse } from "next/server";

/**
 * @vercel/blob auth (see Vercel docs):
 * - On Vercel: OIDC — BLOB_STORE_ID env var + per-request token that the SDK
 *   reads from the request context (x-vercel-oidc-token header). The token is
 *   NOT an env var at runtime, so don't require VERCEL_OIDC_TOKEN there.
 * - Local / external: BLOB_READ_WRITE_TOKEN, or `vercel env pull` for OIDC vars.
 */
export const isBlobConfigured = (): boolean => {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return true;

  const storeId = process.env.BLOB_STORE_ID?.trim();
  if (!storeId) return false;

  if (process.env.VERCEL_OIDC_TOKEN?.trim()) return true;
  return process.env.VERCEL === "1";
};

export const blobNotConfiguredResponse = () =>
  NextResponse.json({ error: "blob_not_configured" }, { status: 503 });
