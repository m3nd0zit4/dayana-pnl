import type { Metadata } from "next";
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
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
