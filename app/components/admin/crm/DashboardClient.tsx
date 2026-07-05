"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardStats } from "@/lib/crm/dashboard-stats";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmPaymentsChart from "./CrmPaymentsChart";
import CrmPipelineChart from "./CrmPipelineChart";
import StatCard from "./StatCard";

type Props = {
  initialData?: DashboardStats | null;
  dbError?: boolean;
};

const DashboardClient = ({ initialData, dbError = false }: Props) => {
  const [data, setData] = useState<DashboardStats | null>(initialData ?? null);
  const [error, setError] = useState<string | null>(
    dbError ? "No se pudo cargar el dashboard. Revisa la base de datos." : null
  );

  useEffect(() => {
    if (initialData !== undefined) return;
    fetch("/api/admin/dashboard", { credentials: "same-origin" })
      .then(async (r) => {
        if (r.status === 401) throw new Error("unauthorized");
        if (!r.ok) throw new Error("fetch");
        return r.json() as Promise<DashboardStats>;
      })
      .then((json) => setData(json))
      .catch((err: Error) => {
        setError(
          err.message === "unauthorized"
            ? "Sesión expirada. Vuelve a iniciar sesión."
            : "No se pudo cargar el dashboard. Revisa la base de datos."
        );
      });
  }, [initialData]);

  if (error) {
    return (
      <CrmPageShell>
        <p className="crm-alert-warning">{error}</p>
      </CrmPageShell>
    );
  }

  if (!data) {
    return (
      <CrmPageShell>
        <p className="text-sm text-[var(--crm-muted)] animate-pulse">Cargando…</p>
      </CrmPageShell>
    );
  }

  const { stats, paymentsByDay, pipeline, recentContacts, activeTherapyRows } =
    data;

  return (
    <CrmPageShell>
      <div className="space-y-5">
        <CrmPageHeader title="Dashboard" />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Leads / pendientes" value={stats.leads} />
          <StatCard label="Pagos hoy" value={stats.paymentsToday} />
          <StatCard label="Terapias activas" value={stats.activeTherapies} />
          <StatCard label="Contactos" value={stats.contacts} />
        </div>

        {stats.unlinkedPaidEnrollments > 0 && (
          <Link
            href="/admin/payments"
            className="block rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 hover:bg-amber-500/15 transition-colors"
          >
            {stats.unlinkedPaidEnrollments} pago
            {stats.unlinkedPaidEnrollments === 1 ? "" : "s"} sin identificar
            (legacy) — revisar en Pagos
          </Link>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <CrmPaymentsChart data={paymentsByDay} />
          <CrmPipelineChart
            data={pipeline.map((p) => ({ label: p.label, count: p.count }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--crm-muted)]">
              Contactos recientes
            </h2>
            <div className="crm-group">
              {recentContacts.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[var(--crm-muted)]">Sin contactos</p>
              ) : (
                recentContacts.map((c) => (
                  <Link
                    key={c.id}
                    href={`/admin/contacts/${c.id}`}
                    className="crm-group-row is-interactive"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {c.firstName} {c.lastName ?? ""}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-[var(--crm-muted)]">
                      {c.phoneE164}
                    </span>
                    <ChevronRight className="crm-group-chevron" aria-hidden />
                  </Link>
                ))
              )}
            </div>
            <Link href="/admin/contacts" className="crm-btn-ghost mt-3 inline-flex text-sm">
              Ver todos
            </Link>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--crm-muted)]">
              Terapias en curso
            </h2>
            <div className="crm-group">
              {activeTherapyRows.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[var(--crm-muted)]">Sin terapias activas</p>
              ) : (
                activeTherapyRows.map((row) => (
                  <div key={row.id} className="crm-group-row">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{row.contactName}</p>
                      <p className="mt-0.5 text-xs text-[var(--crm-muted)]">
                        {row.productTitle}
                        {row.sessions ? ` · ${row.sessions} sesiones` : ""}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </CrmPageShell>
  );
};

export default DashboardClient;
