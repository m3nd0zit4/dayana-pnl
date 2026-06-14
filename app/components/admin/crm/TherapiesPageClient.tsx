"use client";

import Link from "next/link";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import type { TherapyListRow } from "@/lib/crm/therapies-list";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmSegmentedControl from "./CrmSegmentedControl";
import { useCrm } from "./CrmProvider";

type Tab = "active" | "lead";

type Props = {
  preview: boolean;
  initialActive: TherapyListRow[];
  initialLeads: TherapyListRow[];
  loadError?: string | null;
};

const sessionProgress = (used: number, total: number | null): number => {
  if (!total || total <= 0) return 0;
  return Math.min(100, (used / total) * 100);
};

const TherapiesPageClient = ({
  preview,
  initialActive,
  initialLeads,
  loadError,
}: Props) => {
  const { toast } = useCrm();
  const [tab, setTab] = useState<Tab>("active");
  const [activeRows, setActiveRows] = useState(initialActive);
  const [leadRows, setLeadRows] = useState(initialLeads);
  const [error, setError] = useState(loadError ?? null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    if (preview) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/therapies");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "database_unavailable"
            ? "Base de datos no disponible"
            : "No se pudieron cargar las terapias";
        setError(msg);
        toast(msg, "error");
        return;
      }
      setError(null);
      setActiveRows(data.therapies ?? []);
      setLeadRows(data.leads ?? []);
    } catch {
      setError("Error de red");
      toast("No se pudieron cargar las terapias", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const rows = tab === "active" ? activeRows : leadRows;

  return (
    <CrmPageShell>
      <div className="space-y-4">
        <CrmPageHeader
          title="Terapias"
          action={
            !preview ? (
              <button
                type="button"
                className="crm-btn-icon crm-btn-header-icon"
                disabled={refreshing}
                aria-label="Actualizar"
                onClick={() => void refresh()}
              >
                <RefreshCw
                  className={`size-[18px] ${refreshing ? "animate-spin" : ""}`}
                  strokeWidth={1.75}
                />
              </button>
            ) : undefined
          }
          trailing={
            <CrmSegmentedControl
              value={tab}
              onChange={setTab}
              segments={[
                { id: "active", label: "Activas", count: activeRows.length },
                { id: "lead", label: "Por activar", count: leadRows.length },
              ]}
            />
          }
        />

        {error && (
          <div className="crm-alert-warning flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              className="crm-btn-secondary crm-btn-compact"
              onClick={() => void refresh()}
            >
              Reintentar
            </button>
          </div>
        )}

        <div className="crm-group">
          {rows.length === 0 ? (
            <div className="crm-empty">
              <p className="crm-empty-title">
                {tab === "active" ? "Sin terapias activas" : "Sin terapias por activar"}
              </p>
              {tab === "active" && (
                <Link href="/admin/contacts" className="crm-btn-ghost text-sm">
                  Ir a contactos
                </Link>
              )}
            </div>
          ) : (
            rows.map((row) => (
              <div key={row.enrollmentId} className="crm-group-row">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{row.contactName}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--crm-muted)]">
                    {row.phoneE164} · {row.timezone}
                  </p>
                  <p className="mt-1 text-xs text-[var(--crm-muted)]">
                    {row.productTitle} · {enrollmentStatusLabel(row.status)}
                  </p>
                  {row.sessionsTotal != null && row.sessionsTotal > 0 && (
                    <div className="mt-2 h-1.5 max-w-[10rem] overflow-hidden rounded-full bg-black/[0.06]">
                      <div
                        className="h-full rounded-full bg-[var(--crm-accent)]"
                        style={{
                          width: `${sessionProgress(row.sessionsUsed, row.sessionsTotal)}%`,
                        }}
                      />
                    </div>
                  )}
                  {tab === "lead" && (
                    <p className="mt-2 text-xs text-amber-800">
                      Activa desde Gestionar
                    </p>
                  )}
                </div>
                {!preview && (
                  <Link
                    href={`/admin/enrollments/${row.enrollmentId}`}
                    className="crm-btn-secondary crm-btn-compact shrink-0"
                  >
                    {tab === "lead" ? "Activar" : "Gestionar"}
                  </Link>
                )}
                {!preview ? (
                  <Link
                    href={`/admin/contacts/${row.contactId}`}
                    className="crm-group-chevron-link shrink-0"
                    aria-label="Ver ficha del contacto"
                  >
                    <ChevronRight className="crm-group-chevron" aria-hidden />
                  </Link>
                ) : (
                  <ChevronRight className="crm-group-chevron shrink-0" aria-hidden />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </CrmPageShell>
  );
};

export default TherapiesPageClient;
