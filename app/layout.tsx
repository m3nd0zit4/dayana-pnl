import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import Providers from "./providers";

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
  return (
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
