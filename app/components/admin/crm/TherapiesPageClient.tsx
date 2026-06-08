"use client";

import Link from "next/link";
import { MessageCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import type { TherapyListRow } from "@/lib/crm/therapies-list";
import CrmPageShell from "./CrmPageShell";
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

const TherapyRowCard = ({
  row,
  preview,
  showActivateHint,
}: {
  row: TherapyListRow;
  preview: boolean;
  showActivateHint?: boolean;
}) => (
  <li className="crm-table-row p-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-sm font-semibold">{row.contactName}</div>
        <div className="mt-0.5 font-mono text-xs text-[var(--crm-muted)]">
          {row.phoneE164} · {row.timezone}
        </div>
        <div className="mt-1 text-xs text-[var(--crm-muted)]">
          {row.productTitle} · {enrollmentStatusLabel(row.status)}
        </div>
        {row.sessionsTotal != null && row.sessionsTotal > 0 && (
          <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className="h-full rounded-full bg-[var(--crm-accent)]"
              style={{ width: `${sessionProgress(row.sessionsUsed, row.sessionsTotal)}%` }}
            />
          </div>
        )}
        {showActivateHint ? (
          <p className="mt-2 text-xs text-amber-800">
            Activa el servicio para agendar en{" "}
            <Link href="/admin/calendar" className="underline">
              Calendario
            </Link>
            .
          </p>
        ) : row.nextSessionAt ? (
          <p className="mt-2 text-xs font-medium text-[var(--crm-accent)]">
            Próxima: sesión {row.nextSessionNumber} ·{" "}
            {new Date(row.nextSessionAt).toLocaleString("es-CO", {
              timeZone: row.timezone,
            })}
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--crm-muted)]">Sin sesión agendada</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {!preview && (
          <>
            <Link
              href={`/admin/enrollments/${row.enrollmentId}`}
              className="crm-btn-secondary text-center text-xs"
            >
              {showActivateHint ? "Activar / gestionar" : "Gestionar"}
            </Link>
            <Link
              href={`/admin/contacts/${row.contactId}`}
              className="crm-btn-ghost text-center text-xs"
            >
              Ficha contacto
            </Link>
            {buildContactWhatsAppUrl(row.phoneE164) && (
              <a
                href={buildContactWhatsAppUrl(row.phoneE164)!}
                target="_blank"
                rel="noopener noreferrer"
                className="crm-btn-ghost flex items-center justify-center gap-1 text-xs text-[#128C7E]"
              >
                <MessageCircle className="size-3.5" />
                WhatsApp
              </a>
            )}
          </>
        )}
      </div>
    </div>
  </li>
);

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
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="crm-section-title text-xl">Terapias 1:1</h1>
            <p className="crm-section-subtitle mt-1 max-w-xl">
              Terapias activas o con pago pendiente. Los servicios en estado Lead
              están en la pestaña «Por activar».
            </p>
          </div>
          {!preview && (
            <button
              type="button"
              className="crm-btn-ghost inline-flex items-center gap-1 text-xs"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Actualizar
            </button>
          )}
        </div>

        <div className="flex gap-2">
          {(
            [
              { id: "active" as const, label: `Activas (${activeRows.length})` },
              { id: "lead" as const, label: `Por activar (${leadRows.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "bg-[var(--crm-accent-soft)] text-[var(--crm-accent)]"
                  : "text-[var(--crm-muted)] hover:bg-black/[0.04]"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="crm-alert-warning flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" className="crm-btn-secondary text-xs" onClick={() => void refresh()}>
              Reintentar
            </button>
          </div>
        )}

        <div className="crm-surface-card overflow-hidden">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--crm-muted)]">
              {tab === "active" ? (
                <>
                  No hay terapias activas.{" "}
                  <Link href="/admin/contacts" className="text-[var(--crm-accent)] underline">
                    Crea un contacto
                  </Link>
                  , agrega un servicio de terapia y actívalo.
                </>
              ) : (
                <>No hay terapias en estado Lead.</>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--crm-border)]">
              {rows.map((row) => (
                <TherapyRowCard
                  key={row.enrollmentId}
                  row={row}
                  preview={preview}
                  showActivateHint={tab === "lead"}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </CrmPageShell>
  );
};

export default TherapiesPageClient;
