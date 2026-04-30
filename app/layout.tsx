import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { CookieConsentProvider } from "./context/CookieConsentContext";
import ConsentBasedVercelInsights from "./components/legal/ConsentBasedVercelInsights";
import CookieConsentBanner from "./components/legal/CookieConsentBanner";

export const metadata: Metadata = {
  title: "Dayana Beltrán — Maestra PNL",
  description:
    "Dayana Beltrán, maestra en Programación Neurolingüística. Terapias 1:1 y cursos en vivo para reprogramar creencias, patrones y emociones.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const analyticsAllowed = process.env.VERCEL === "1";

  return (
    <html lang="es">
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
