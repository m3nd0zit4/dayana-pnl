import { redirect } from "next/navigation";

/**
 * Absorbido por el hub de `/admin/ajustes/integraciones` (sección
 * `#redes-sociales`). Se mantiene como redirect, no se borra, para no romper
 * enlaces guardados ni los `dest` de OAuth que todavía apuntan aquí (ver
 * `lib/social/oauth-state.ts` — el mapa de destinos también se actualiza en
 * este cambio).
 */
const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string; tiktok?: string }>;
}) => {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.meta) query.set("meta", params.meta);
  if (params.tiktok) query.set("tiktok", params.tiktok);
  const qs = query.toString();
  redirect(
    `/admin/ajustes/integraciones${qs ? `?${qs}` : ""}#redes-sociales`
  );
};

export default Page;
