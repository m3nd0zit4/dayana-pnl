import type { Metadata } from "next";
import NotFoundView from "./components/site/NotFoundView";
import { BRAND } from "@/lib/contact";

export const metadata: Metadata = {
  title: `Página no encontrada — ${BRAND.shortName}`,
  description: "La página que buscas no existe o fue movida.",
  robots: { index: false, follow: false },
};

const NotFound = () => <NotFoundView />;

export default NotFound;
