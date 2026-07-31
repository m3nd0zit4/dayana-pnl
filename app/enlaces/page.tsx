import type { Metadata } from "next";
import { BRAND } from "@/lib/contact";
import LinktreePage from "@/app/components/enlaces/LinktreePage";

const title = `Enlaces — ${BRAND.name}`;
const description =
  "Todos los enlaces de Dayana Beltrán: WhatsApp, servicios, talleres, portal de miembros y redes sociales.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/enlaces" },
  openGraph: { title, description, url: "/enlaces", type: "website" },
};

const Page = () => <LinktreePage />;

export default Page;
