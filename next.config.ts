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
      // El catálogo público de terapias se retiró: los paquetes ya no se
      // navegan por precio. Se entra por el cuestionario, que recomienda uno
      // solo, y lo que se acuerda por llamada se cobra con un enlace generado
      // desde /admin/enlaces-pago.
      //
      // Las tres URLs viejas apuntan al mismo sitio y en un solo salto — están
      // indexadas, en el sitemap, en llms.txt y repartidas por WhatsApp en
      // conversaciones ya cerradas.
      { source: "/servicios", destination: "/terapias/empezar", permanent: true },
      { source: "/diagnostico", destination: "/terapias/empezar", permanent: true },
      { source: "/terapias", destination: "/terapias/empezar", permanent: true },
      // La página de "quién es Dayana" se retiró; su argumento vive ahora en la
      // home y en el resultado del cuestionario.
      { source: "/dayana", destination: "/", permanent: true },
      /**
       * El panel del portal se retiró: `/cursos` es ahora la única puerta.
       *
       * Enseñaba las mismas tarjetas que el catálogo público pero sólo a quien
       * ya había entrado, así que había dos sitios donde mirar «mis cursos» y
       * ninguno era el que la gente encontraba primero. Las tarjetas de
       * `/cursos` ya traen progreso y «Continuar» cuando hay sesión.
       *
       * SÓLO la raíz: `/miembros/curso/*` y `/miembros/cuenta/*` son la
       * plataforma y no se mueven — hay correos ya enviados que apuntan ahí.
       *
       * Temporal a propósito. Un 308 se queda cacheado en el navegador para
       * siempre, y esto es una decisión de producto, no una URL muerta: si el
       * panel volviera, nadie debería tener que limpiar su caché.
       */
      { source: "/miembros", destination: "/cursos", permanent: false },
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
