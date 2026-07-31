import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export const revalidate = 3600;

const STATIC_ROUTES: {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}[] = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/servicios", changeFrequency: "monthly", priority: 0.9 },
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
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const now = new Date();

  return STATIC_ROUTES.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
