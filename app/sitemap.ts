import type { MetadataRoute } from "next";
import { isFreeWebinarActive } from "@/lib/crm/free-webinar";
import { listCourseSlugs } from "@/lib/courses/catalog";
import { getSiteUrl } from "@/lib/site-url";

export const revalidate = 3600;

const STATIC_ROUTES: {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}[] = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/terapias", changeFrequency: "monthly", priority: 0.9 },
  { path: "/cursos", changeFrequency: "weekly", priority: 0.9 },
  // El cuestionario es la entrada del embudo de terapias; su página de
  // resultado (/terapias/resultado/<token>) queda fuera a propósito: lleva
  // datos personales y se sirve con noindex.
  { path: "/terapias/empezar", changeFrequency: "monthly", priority: 0.8 },
  { path: "/dayana", changeFrequency: "monthly", priority: 0.7 },
  { path: "/historias", changeFrequency: "monthly", priority: 0.7 },
  { path: "/taller-virtual", changeFrequency: "weekly", priority: 0.8 },
  { path: "/enlaces", changeFrequency: "monthly", priority: 0.3 },
  { path: "/aviso-privacidad", changeFrequency: "yearly", priority: 0.1 },
  { path: "/cookies", changeFrequency: "yearly", priority: 0.1 },
  { path: "/terminos", changeFrequency: "yearly", priority: 0.1 },
];

// Note: /taller-virtual/[slug] deliberately excluded — that route redirects
// anonymous visitors to /taller-virtual whenever the edition has a linked
// product (see app/taller-virtual/[slug]/page.tsx), so it isn't a page
// crawlers can actually land on.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const now = new Date();

  const routes = [...STATIC_ROUTES];
  try {
    if (await isFreeWebinarActive()) {
      routes.push({
        path: "/webinar-gratuito",
        changeFrequency: "weekly",
        priority: 0.85,
      });
    }
  } catch {
    /* DB unavailable — omit webinar from sitemap */
  }

  // Cada curso de la biblioteca es una página que se posiciona por su cuenta
  // ("PNL para pareja", "hipnosis"), así que entran uno a uno y no sólo el
  // listado. Se leen de la DB: publicar un curso no debería exigir un deploy.
  try {
    for (const slug of await listCourseSlugs()) {
      routes.push({
        path: `/cursos/${slug}`,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  } catch {
    /* DB unavailable — omit courses from sitemap */
  }

  return routes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
