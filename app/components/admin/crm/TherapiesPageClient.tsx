"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import Link from "next/link";
import { Calendar, ChevronRight, HeartHandshake, RefreshCw } from "lucide-react";
import { useState } from "react";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import type { TherapyListRow } from "@/lib/crm/therapies-list";
import { formatSessionDateTimeEs } from "@/lib/crm/datetime-local";
import { Button } from "@/app/components/ui/button";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmSegmentedControl from "./CrmSegmentedControl";
import { useCrm } from "./CrmProvider";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmErrorState,
} from "./ui";

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
      <CrmPageHeader
        title="Terapias"
        description="Procesos individuales en curso y los que están esperando activación."
        // Refrescar es apoyo, no la acción principal de la página. Antes ocupaba
        // el hueco que en el resto del CRM es para crear, así que en esta
        // sección el botón de arriba a la derecha significaba otra cosa.
        secondaryActions={
          !preview ? (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={refreshing}
              aria-label="Actualizar"
              title="Actualizar"
              onClick={() => void refresh()}
            >
              <RefreshCw
                className={refreshing ? "animate-spin" : ""}
                strokeWidth={1.75}
                aria-hidden
              />
            </Button>
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

      {error ? <CrmErrorState message={error} onRetry={() => void refresh()} /> : null}

      <CrmDataList>
        {rows.length === 0 ? (
          <CrmEmptyState
            icon={HeartHandshake}
            title={
              tab === "active" ? "Sin terapias activas" : "Sin terapias por activar"
            }
            description={
              tab === "active"
                ? "Cuando alguien contrate un paquete de sesiones aparecerá aquí."
                : "Los paquetes pagados que aún no han empezado se listan en esta pestaña."
            }
            action={
              tab === "active" ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/admin/contacts" />}
                >
                  Ir a contactos
                </Button>
              ) : undefined
            }
          />
        ) : (
          rows.map((row) => (
            <CrmDataListRow
              key={row.enrollmentId}
              actions={
                <div className="flex items-center gap-2">
                  {!preview ? (
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/admin/enrollments/${row.enrollmentId}`} />}
                    >
                      {tab === "lead" ? "Activar" : "Gestionar"}
                    </Button>
                  ) : null}
                  {!preview ? (
                    <Link
                      href={`/admin/contacts/${row.contactId}`}
                      aria-label="Ver ficha del contacto"
                    >
                      <ChevronRight
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                    </Link>
                  ) : (
                    <ChevronRight
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                </div>
              }
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{row.contactName}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {displayContactPhone(row.phoneE164) ?? "Sin teléfono"} ·{" "}
                  {row.timezone}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.productTitle} · {enrollmentStatusLabel(row.status)}
                </p>
                {row.sessionsTotal != null && row.sessionsTotal > 0 ? (
                  <div className="mt-2 h-1.5 max-w-[10rem] overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${sessionProgress(row.sessionsUsed, row.sessionsTotal)}%`,
                      }}
                    />
                  </div>
                ) : null}
                {tab === "active" && row.nextSessionAt ? (
                  <p className="mt-2 inline-flex items-center gap-1 text-xs">
                    <Calendar
                      className="size-3.5 text-muted-foreground"
                      aria-hidden
                    />
                    Próxima: {formatSessionDateTimeEs(row.nextSessionAt, row.timezone)}
                    {row.nextSessionNumber != null ? (
                      <span className="text-muted-foreground">
                        · sesión {row.nextSessionNumber}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {tab === "lead" ? (
                  <p className="mt-2 text-xs text-warning">Activa desde Gestionar</p>
                ) : null}
              </div>
            </CrmDataListRow>
          ))
        )}
      </CrmDataList>
    </CrmPageShell>
  );
};

export default TherapiesPageClient;
