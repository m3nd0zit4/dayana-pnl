import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { CookieConsentProvider } from "./context/CookieConsentContext";
import ConsentBasedVercelInsights from "./components/legal/ConsentBasedVercelInsights";
import CookieConsentBanner from "./components/legal/CookieConsentBanner";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://dayanabeltran.com";

const siteTitle = "Dayana Beltrán PNL — Reprogramadora Neuronal";
const siteDescription =
  "Dayana Beltrán Coach en PNL, especialisada en Neurociencia y Neuroplasticidad. Sesiones Privadas 1:1, cursos y talleres en vivo para reprogramar creencias limitantes, patrones y emociones negativas.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  icons: {
    icon: [
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/site.webmanifest",
  appleWebApp: {
    title: "Dayana B",
  },
  openGraph: {
    type: "website",
    locale: "es_ES",
    url: siteUrl,
    siteName: "Dayana Beltrán PNL",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: "/og-image.png",
        width: 1083,
        height: 568,
        alt: "Dayana Beltrán PNL — Cambiamos Realidades",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const analyticsAllowed = process.env.VERCEL === "1";

  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* LCP hero image — preloaded per breakpoint, exactly matching the
            <picture> sources in Hero so the fetch is reused (faster FCP/LCP). */}
        <link
          rel="preload"
          as="image"
          type="image/avif"
          media="(min-width: 768px)"
          imageSrcSet="/hero/hero-desktop.avif 1500w, /hero/hero-desktop-2200.avif 2200w"
          imageSizes="100vw"
        />
        <link
          rel="preload"
          as="image"
          type="image/avif"
          media="(max-width: 767px)"
          imageSrcSet="/hero/hero-mobile.avif 900w, /hero/hero-mobile-1320.avif 1320w"
          imageSizes="100vw"
        />
        <link
          rel="preload"
          href="/fonts/Lausanne-300.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Lausanne-500.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/SpaceGrotesk-700.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/DMMono-500.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <CookieConsentProvider analyticsAllowed={analyticsAllowed}>
          <Providers>{children}</Providers>
          <ConsentBasedVercelInsights />
          <CookieConsentBanner />
        </CookieConsentProvider>
      </body>
    </html>
  );
}
