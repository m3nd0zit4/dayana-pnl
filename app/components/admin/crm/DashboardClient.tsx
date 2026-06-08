"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CalendarCheck,
  CreditCard,
  HeartPulse,
  Users,
} from "lucide-react";
import type { DashboardStats } from "@/lib/crm/dashboard-stats";
import CrmPageShell from "./CrmPageShell";
import CrmPaymentsChart from "./CrmPaymentsChart";
import CrmPipelineChart from "./CrmPipelineChart";
import StatCard from "./StatCard";

const DashboardClient = () => {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then((r) => {
        if (!r.ok) throw new Error("fetch");
        return r.json();
      })
      .then((json: DashboardStats) => setData(json))
      .catch(() => setError("No se pudo cargar el dashboard. Revisa la base de datos."));
  }, []);

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
        <p className="text-sm text-[var(--crm-muted)] animate-pulse">
          Cargando métricas…
        </p>
      </CrmPageShell>
    );
  }

  const { stats, paymentsByDay, pipeline, recentContacts, activeTherapyRows } =
    data;

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div>
          <h1 className="crm-section-title text-xl">Dashboard</h1>
          <p className="crm-section-subtitle mt-1 max-w-2xl">
            Terapias, talleres y pagos de clientes internacionales — todo desde un
            solo panel.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Leads / pendientes"
            value={stats.leads}
            icon={CalendarCheck}
            accent="#b8860b"
          />
          <StatCard
            label="Pagos hoy"
            value={stats.paymentsToday}
            icon={CreditCard}
            accent="var(--crm-accent)"
          />
          <StatCard
            label="Terapias activas"
            value={stats.activeTherapies}
            icon={HeartPulse}
            accent="var(--crm-success)"
          />
          <StatCard
            label="Contactos"
            value={stats.contacts}
            icon={Users}
            accent="var(--crm-blush)"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <CrmPaymentsChart data={paymentsByDay} />
          <CrmPipelineChart
            data={pipeline.map((p) => ({ label: p.label, count: p.count }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="crm-surface-card p-5">
            <h2 className="crm-section-title text-sm">Contactos recientes</h2>
            <ul className="mt-4 divide-y divide-[var(--crm-border)]">
              {recentContacts.map((c) => (
                <li key={c.id} className="crm-table-row py-3 first:pt-0">
                  <Link
                    href={`/admin/contacts/${c.id}`}
                    className="flex justify-between gap-2 hover:opacity-80"
                  >
                    <span className="font-medium">
                      {c.firstName} {c.lastName ?? ""}
                    </span>
                    <span className="font-mono text-xs text-[var(--crm-muted)]">
                      {c.phoneE164}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/admin/contacts" className="crm-btn-ghost mt-4 inline-block">
              Ver todos →
            </Link>
          </div>

          <div className="crm-surface-card p-5">
            <h2 className="crm-section-title text-sm">Terapias en curso</h2>
            <ul className="mt-4 space-y-3">
              {activeTherapyRows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-background)]/50 px-4 py-3"
                >
                  <div className="text-sm font-medium">{row.contactName}</div>
                  <div className="mt-0.5 text-xs text-[var(--crm-muted)]">
                    {row.productTitle}
                    {row.sessions ? ` · ${row.sessions} sesiones` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href="/admin/contacts" className="crm-btn-primary">
            Gestionar contactos
          </Link>
          <Link href="/admin/workshops" className="crm-btn-secondary">
            Talleres
          </Link>
        </div>
      </div>
    </CrmPageShell>
  );
};

export default DashboardClient;
