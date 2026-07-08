import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

/** El acceso es único en /acceso; esta ruta queda por compatibilidad. */
const SignInPage = async ({ searchParams }: PageProps) => {
  const params = await searchParams;
  const query = new URLSearchParams();
  query.set("callbackUrl", params.callbackUrl ?? "/admin");
  if (params.error) query.set("error", params.error);
  redirect(`/acceso?${query.toString()}`);
};

export default SignInPage;
