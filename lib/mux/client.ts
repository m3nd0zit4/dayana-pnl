import { NextResponse } from "next/server";
import Mux from "@mux/mux-node";

/**
 * Cliente único de Mux (Vercel Marketplace integration).
 *
 * MUX_TOKEN_ID/MUX_TOKEN_SECRET autentican la API (uploads, assets, JWT
 * signing). MUX_WEBHOOK_SECRET y MUX_SIGNING_KEY_ID/MUX_SIGNING_KEY_PRIVATE
 * son credenciales aparte que no provisiona el install del marketplace —
 * se crean a mano en el dashboard de Mux (webhook endpoint + signing key).
 */
export const isMuxConfigured = (): boolean =>
  Boolean(
    process.env.MUX_TOKEN_ID?.trim() && process.env.MUX_TOKEN_SECRET?.trim()
  );

let cached: Mux | null = null;

export const getMuxClient = (): Mux => {
  if (cached) return cached;

  const tokenId = process.env.MUX_TOKEN_ID?.trim();
  const tokenSecret = process.env.MUX_TOKEN_SECRET?.trim();
  if (!tokenId || !tokenSecret) {
    throw new Error(
      "Mux no configurado: define MUX_TOKEN_ID y MUX_TOKEN_SECRET"
    );
  }

  cached = new Mux({
    tokenId,
    tokenSecret,
    // Named *_ID/*_PRIVATE here (not the SDK's own MUX_SIGNING_KEY/MUX_PRIVATE_KEY
    // defaults) to match this repo's env-var naming and lib/env.server.ts.
    jwtSigningKey: process.env.MUX_SIGNING_KEY_ID?.trim() || null,
    jwtPrivateKey: process.env.MUX_SIGNING_KEY_PRIVATE?.trim() || null,
  });
  return cached;
};

export const isMuxSigningConfigured = (): boolean =>
  Boolean(
    process.env.MUX_SIGNING_KEY_ID?.trim() &&
      process.env.MUX_SIGNING_KEY_PRIVATE?.trim()
  );

export const muxNotConfiguredResponse = () =>
  NextResponse.json({ error: "mux_not_configured" }, { status: 503 });
