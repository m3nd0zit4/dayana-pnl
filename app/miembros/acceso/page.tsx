import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

/** El acceso es único en /acceso; esta ruta queda por compatibilidad. */
const Page = async ({ searchParams }: PageProps) => {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.callbackUrl) query.set("callbackUrl", params.callbackUrl);
  if (params.error) query.set("error", params.error);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  redirect(`/acceso${suffix}`);
};

export default Page;
