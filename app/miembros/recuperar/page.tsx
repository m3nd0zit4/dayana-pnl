import type { Metadata } from "next";
import { BRAND } from "@/lib/contact";
import MemberAuthShell from "@/app/components/miembros/MemberAuthShell";
import RequestAccessForm from "@/app/components/miembros/RequestAccessForm";

export const metadata: Metadata = {
  title: `Recupera tu contraseña — ${BRAND.name}`,
  description: "Restablece tu contraseña del portal de miembros.",
  robots: { index: false, follow: false },
};

const Page = () => (
  <MemberAuthShell
    eyebrow="Portal de miembros"
    title="Recupera tu acceso"
    description="Escribe tu correo y te enviamos un enlace para crear una nueva contraseña."
  >
    <RequestAccessForm buttonLabel="Enviarme el enlace" />
  </MemberAuthShell>
);

export default Page;
