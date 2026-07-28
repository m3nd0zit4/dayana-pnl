import { siteUrl } from "@/lib/notifications/config";

/**
 * A dónde devuelve Vercel Connect al navegador cuando termina el
 * consentimiento.
 *
 * Se prefiere el origen de la propia petición para que funcione igual en
 * localhost y en cada despliegue de preview, donde `NEXT_PUBLIC_SITE_URL`
 * apunta a producción y mandaría al operador al sitio equivocado. Connect solo
 * acepta https o localhost, que es exactamente lo que cubren esos dos casos.
 */
export const googleCallbackUrl = (req: Request, accountId: string): string => {
  let origin: string;
  try {
    origin = new URL(req.url).origin;
  } catch {
    origin = siteUrl();
  }

  const url = new URL("/api/admin/google/callback", origin);
  url.searchParams.set("accountId", accountId);
  return url.toString();
};
