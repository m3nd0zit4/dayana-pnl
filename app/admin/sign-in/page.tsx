import Link from "next/link";
import { Suspense } from "react";
import AdminSignInForm from "@/app/components/admin/AdminSignInForm";

const SignInPage = () => (
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

export default SignInPage;
