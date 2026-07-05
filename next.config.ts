import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/** Report-only CSP — tighten after verifying PayPal/MP/GSAP in production. */
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.paypal.com https://www.sandbox.paypal.com https://sdk.mercadopago.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.mercadopago.com https://api-m.paypal.com https://api-m.sandbox.paypal.com https://www.paypal.com https:",
  "frame-src 'self' https://www.paypal.com https://www.sandbox.paypal.com https://www.mercadopago.com https://www.youtube.com https://www.youtube-nocookie.com https://drive.google.com",
  "base-uri 'self'",
  "form-action 'self' https://www.paypal.com https://www.mercadopago.com",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma", "ws"],
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

export default nextConfig;
