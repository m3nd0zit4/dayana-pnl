"use client";

import Link from "next/link";
import { Calendar, ChevronRight, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { enrollmentStatusLabel } from "@/lib/crm/enrollment-labels";
import type { TherapyListRow } from "@/lib/crm/therapies-list";
import { formatSessionDateTimeEs } from "@/lib/crm/datetime-local";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
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
              <Button
                variant="ghost"
                size="icon"
                disabled={refreshing}
                aria-label="Actualizar"
                onClick={() => void refresh()}
              >
                <RefreshCw className={refreshing ? "animate-spin" : ""} strokeWidth={1.75} />
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

        {error && (
          <Alert className="flex flex-wrap items-center justify-between gap-3">
            <TriangleAlert />
            <AlertDescription className="flex flex-1 flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
            {rows.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-semibold">
                  {tab === "active" ? "Sin terapias activas" : "Sin terapias por activar"}
                </p>
                {tab === "active" && (
                  <Button variant="ghost" size="sm" className="mt-2" nativeButton={false} render={<Link href="/admin/contacts" />}>
                    Ir a contactos
                  </Button>
                )}
              </div>
            ) : (
              rows.map((row) => (
                <div key={row.enrollmentId} className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{row.contactName}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {row.phoneE164} · {row.timezone}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.productTitle} · {enrollmentStatusLabel(row.status)}
                    </p>
                    {row.sessionsTotal != null && row.sessionsTotal > 0 && (
                      <div className="mt-2 h-1.5 max-w-[10rem] overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${sessionProgress(row.sessionsUsed, row.sessionsTotal)}%`,
                          }}
                        />
                      </div>
                    )}
                    {tab === "active" && row.nextSessionAt && (
                      <p className="mt-2 inline-flex items-center gap-1 text-xs">
                        <Calendar className="size-3.5 text-muted-foreground" aria-hidden />
                        Próxima: {formatSessionDateTimeEs(row.nextSessionAt, row.timezone)}
                        {row.nextSessionNumber != null ? (
                          <span className="text-muted-foreground">
                            · sesión {row.nextSessionNumber}
                          </span>
                        ) : null}
                      </p>
                    )}
                    {tab === "lead" && (
                      <p className="mt-2 text-xs text-amber-700">Activa desde Gestionar</p>
                    )}
                  </div>
                  {!preview && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      nativeButton={false}
                      render={<Link href={`/admin/enrollments/${row.enrollmentId}`} />}
                    >
                      {tab === "lead" ? "Activar" : "Gestionar"}
                    </Button>
                  )}
                  {!preview ? (
                    <Link
                      href={`/admin/contacts/${row.contactId}`}
                      className="shrink-0"
                      aria-label="Ver ficha del contacto"
                    >
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </Link>
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </CrmPageShell>
  );
};

export default TherapiesPageClient;
