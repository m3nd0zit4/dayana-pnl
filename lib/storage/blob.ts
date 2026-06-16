import { NextResponse } from "next/server";

/**
 * @vercel/blob auth (see Vercel docs):
 * - On Vercel: OIDC via BLOB_STORE_ID + VERCEL_OIDC_TOKEN (injected on deploy).
 * - Local / external: BLOB_READ_WRITE_TOKEN, or `vercel env pull` for OIDC vars.
 */
export const isBlobConfigured = (): boolean => {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return true;

  const storeId = process.env.BLOB_STORE_ID?.trim();
  const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
  return Boolean(storeId && oidcToken);
};

export const blobNotConfiguredResponse = () =>
  NextResponse.json({ error: "blob_not_configured" }, { status: 503 });
