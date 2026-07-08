"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Card, CardContent } from "@/app/components/ui/card";
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
          <h1 className="text-xl font-semibold tracking-tight">Auditoría</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registro de acciones del staff en el CRM (OWNER).
          </p>
        </div>
        {error && (
          <Alert>
            <TriangleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0 text-sm">
            {logs.length === 0 && !error && (
              <div className="p-6 text-muted-foreground">Sin registros aún.</div>
            )}
            {logs.map((l) => (
              <div key={l.id} className="p-4">
                <div className="font-medium">
                  {l.action} · {l.entityType}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {l.entityId.slice(0, 8)}…
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {l.staffUser?.displayName ?? "—"} ·{" "}
                  {new Date(l.createdAt).toLocaleString("es-CO")}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </CrmPageShell>
  );
};

export default AuditPageClient;
