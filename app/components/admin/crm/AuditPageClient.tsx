"use client";

import { useEffect, useState } from "react";
import CrmPageShell from "./CrmPageShell";

type Log = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  staffUser: { displayName: string; email: string } | null;
};

type Props = { preview: boolean };

const AuditPageClient = ({ preview }: Props) => {
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) {
      setError("Auditoría no disponible en vista previa");
      return;
    }
    fetch("/api/admin/audit")
      .then(async (r) => {
        const d = (await r.json()) as { logs?: Log[]; error?: string };
        if (!r.ok) {
          setError(d.error === "forbidden" ? "Solo OWNER puede ver auditoría" : "Error");
          return;
        }
        setLogs(
          (d.logs ?? []).map((l) => ({
            ...l,
            createdAt:
              typeof l.createdAt === "string"
                ? l.createdAt
                : new Date(l.createdAt as unknown as string).toISOString(),
          }))
        );
      })
      .catch(() => setError("No se pudo cargar auditoría"));
  }, [preview]);

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div>
          <h1 className="crm-section-title text-xl">Auditoría</h1>
          <p className="crm-section-subtitle mt-1">
            Registro de acciones del staff en el CRM (OWNER).
          </p>
        </div>
        {error && <p className="crm-alert-warning">{error}</p>}
        <div className="crm-surface-card overflow-hidden">
          <ul className="divide-y divide-[var(--crm-border)] text-sm">
            {logs.length === 0 && !error && (
              <li className="p-6 text-[var(--crm-muted)]">Sin registros aún.</li>
            )}
            {logs.map((l) => (
              <li key={l.id} className="p-4">
                <div className="font-medium">
                  {l.action} · {l.entityType}{" "}
                  <span className="font-mono text-xs text-[var(--crm-muted)]">
                    {l.entityId.slice(0, 8)}…
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--crm-muted)]">
                  {l.staffUser?.displayName ?? "—"} ·{" "}
                  {new Date(l.createdAt).toLocaleString("es-CO")}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </CrmPageShell>
  );
};

export default AuditPageClient;
