import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/auth";
import AdminSignInForm from "@/app/components/admin/AdminSignInForm";
import { getStaffSession } from "@/lib/auth/staff-session";

const SignInPage = async () => {
  const session = await auth();
  const staff = await getStaffSession();

  if (session?.user?.kind === "member") {
    redirect("/miembros");
  }

  if (session?.user?.id && !staff) {
    redirect("/api/auth/signout?callbackUrl=/admin/sign-in");
  }

  if (staff) {
    redirect("/admin");
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={{
        background:
          "radial-gradient(60% 50% at 50% 0%, rgba(237,195,177,0.35), transparent), var(--crm-background)",
      }}
    >
      <div className="mb-8 w-full max-w-md">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[13px] text-[var(--crm-muted)] transition-colors hover:text-[var(--crm-foreground)]"
        >
          <span aria-hidden>←</span>
          Volver a dayanabeltran.com
        </Link>
      </div>
      <Suspense
        fallback={
          <p className="text-sm text-[var(--crm-muted)] animate-pulse">
            Cargando acceso…
          </p>
        }
      >
        <AdminSignInForm />
      </Suspense>
    </div>
  );
};

export default SignInPage;
