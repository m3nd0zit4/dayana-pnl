import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { CookieConsentProvider } from "./context/CookieConsentContext";
import ConsentBasedVercelInsights from "./components/legal/ConsentBasedVercelInsights";
import CookieConsentBanner from "./components/legal/CookieConsentBanner";

export const metadata: Metadata = {
  title: "Dayana Beltrán PNL — Reprogramadora Neuronal",
  description:
    "Dayana Beltrán Coach en PNL, especialisada en Neurociencia y Neuroplasticidad. Sesiones Privadas 1:1, cursos y talleres en vivo para reprogramar creencias limitantes, patrones y emociones negativas.",
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
