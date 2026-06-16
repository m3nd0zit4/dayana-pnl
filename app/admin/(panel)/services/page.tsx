import { Suspense } from "react";
import ServicesPageClient from "@/app/components/admin/crm/ServicesPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { listEnrollmentsAdmin } from "@/lib/crm/enrollments-list";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ status?: string; q?: string }>;
};

const ServicesPage = async ({ searchParams }: Props) => {
  const preview = isCrmUiPreview();
  const sp = await searchParams;
  const initialStatus = sp.status ?? "all";
  const initialQ = sp.q?.trim() ?? "";

  if (preview) {
    return (
      <Suspense fallback={<p className="p-6 text-sm text-[var(--crm-muted)]">Cargando…</p>}>
        <ServicesPageClient preview />
      </Suspense>
    );
  }

  try {
    const rows = await listEnrollmentsAdmin({
      status: initialStatus,
      q: initialQ,
    });
    return (
      <Suspense fallback={<p className="p-6 text-sm text-[var(--crm-muted)]">Cargando…</p>}>
        <ServicesPageClient
          preview={false}
          initialRows={rows}
          initialStatus={initialStatus}
          initialQ={initialQ}
        />
      </Suspense>
    );
  } catch {
    return (
      <Suspense fallback={<p className="p-6 text-sm text-[var(--crm-muted)]">Cargando…</p>}>
        <ServicesPageClient preview={false} initialRows={[]} />
      </Suspense>
    );
  }
};

export default ServicesPage;
