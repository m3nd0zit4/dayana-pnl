import type { Metadata } from "next";
import { BRAND } from "@/lib/contact";
import LinktreePage from "@/app/components/enlaces/LinktreePage";

export const metadata: Metadata = {
  title: `Enlaces — ${BRAND.name}`,
  description:
    "Todos los enlaces de Dayana Beltrán: WhatsApp, servicios, talleres, portal de miembros y redes sociales.",
};

const Page = () => <LinktreePage />;

export default Page;
