import type { NextConfig } from "next";
import { withEve } from "eve/next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=()",
  },
];

/** Report-only CSP — tighten after verifying PayPal/MP/GSAP in production. */
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.paypal.com https://www.sandbox.paypal.com https://sdk.mercadopago.com https://www.googletagmanager.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Mux Player uses MSE (blob: video src) backed by HLS segment fetches over
  // connect-src, which already allows any https: origin below — media-src
  // still needs its own entry since it has no such catch-all fallback.
  "media-src 'self' blob: https://stream.mux.com",
  "connect-src 'self' https://api.mercadopago.com https://api-m.paypal.com https://api-m.sandbox.paypal.com https://www.paypal.com https:",
  "frame-src 'self' https://www.paypal.com https://www.sandbox.paypal.com https://www.mercadopago.com https://www.youtube.com https://www.youtube-nocookie.com https://drive.google.com",
  "base-uri 'self'",
  "form-action 'self' https://www.paypal.com https://www.mercadopago.com",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma", "ws"],
  /**
   * Sólo para probar la pasarela por un túnel público (ngrok): sin esto Next
   * bloquea `/_next/*` desde ese host y los componentes de cliente nunca
   * hidratan — el checkout aparece sin botones, como si la página estuviera
   * rota. La URL cambia en cada arranque del túnel, así que vive en
   * `DEV_ALLOWED_ORIGIN` y no en este archivo, que sí se commitea.
   */
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGIN
    ? [process.env.DEV_ALLOWED_ORIGIN]
    : [],
  experimental: {
    // Turbopack's persistent dev cache (.next/dev, on by default since 16.1)
    // can go stale after an unclean dev-server restart: route handlers under
    // dynamic segments (e.g. the NextAuth catch-all) silently stop resolving
    // and fall through to the app 404 page while everything else still hits
    // its cached entry. That's the ClientFetchError "<!DOCTYPE" auth error.
    // Disabled for dev only — build caching is unaffected.
    turbopackFileSystemCacheForDev: false,
  },
  async redirects() {
    return [
      // El listado de servicios se retiró; el CRM gestiona por tipo.
      { source: "/admin/services", destination: "/admin/curso", permanent: false },
      // `/servicios` vendía terapias y cursos a la vez; ahora son dos páginas.
      // 308 permanente y para siempre: la URL está indexada, en el sitemap, en
      // llms.txt y repartida por WhatsApp en conversaciones ya cerradas.
      { source: "/servicios", destination: "/terapias", permanent: true },
      // El cuestionario dejó de ser una página suelta y pasó a ser la puerta
      // de /terapias. Los enlaces cortos de redes ya circulan.
      { source: "/diagnostico", destination: "/terapias/empezar", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          {
            key: "Content-Security-Policy-Report-Only",
            value: cspReportOnly,
          },
        ],
      },
    ];
  },
};

export default withEve(nextConfig);
