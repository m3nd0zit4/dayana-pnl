import { redirect } from "next/navigation";

/**
 * Absorbido por el hub de `/admin/ajustes/integraciones` (sección `#google`).
 * Se mantiene como redirect, no se borra, para no romper enlaces guardados.
 */
const Page = async ({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) => {
  const { google } = await searchParams;
  redirect(
    `/admin/ajustes/integraciones${google ? `?google=${google}` : ""}#google`
  );
};

export default Page;
