"use client";

import { displayContactPhone } from "@/lib/crm/contact-phone";
import Link from "next/link";
import { ChevronRight, Send, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardStats } from "@/lib/crm/dashboard-stats";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { useCrm } from "./CrmProvider";
import CrmPageShell from "./CrmPageShell";
import CrmPaymentsChart from "./CrmPaymentsChart";
import CrmPipelineChart from "./CrmPipelineChart";
import StatCard from "./StatCard";

const AskAgentBox = () => {
  const { agentEnabled, askAgent } = useCrm();
  const [value, setValue] = useState("");

  if (!agentEnabled) return null;

  const submit = () => {
    const message = value.trim();
    if (!message) return;
    askAgent(message);
    setValue("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm"
    >
      <Sparkles className="size-4 shrink-0 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Pregunta lo que quieras…"
        className="border-0 shadow-none focus-visible:ring-0"
      />
      <Button type="submit" size="icon" variant="ghost" disabled={!value.trim()} aria-label="Preguntar">
        <Send className="size-4" />
      </Button>
    </form>
  );
};

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
        <Alert>
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </CrmPageShell>
    );
  }

  if (!data) {
    return (
      <CrmPageShell>
        <p className="animate-pulse text-sm text-muted-foreground">Cargando…</p>
      </CrmPageShell>
    );
  }

  const { stats, paymentsByDay, pipeline, recentContacts, activeTherapyRows } =
    data;

  return (
    <CrmPageShell>
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>

        <AskAgentBox />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Leads / pendientes" value={stats.leads} />
          <StatCard label="Pagos hoy" value={stats.paymentsToday} />
          <StatCard label="Terapias activas" value={stats.activeTherapies} />
          <StatCard label="Contactos" value={stats.contacts} />
        </div>

        {stats.unlinkedPaidEnrollments > 0 && (
          <Link
            href="/admin/payments"
            className="block rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 transition-colors hover:bg-amber-500/15"
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
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              Contactos recientes
            </h2>
            <Card className="overflow-hidden py-0">
              <CardContent className="divide-y divide-border p-0">
                {recentContacts.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">Sin contactos</p>
                ) : (
                  recentContacts.map((c) => (
                    <Link
                      key={c.id}
                      href={`/admin/contacts/${c.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-sm">
                        {c.firstName} {c.lastName ?? ""}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {displayContactPhone(c.phoneE164) ?? "Sin teléfono"}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              nativeButton={false}
              render={<Link href="/admin/contacts" />}
            >
              Ver todos
            </Button>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              Terapias en curso
            </h2>
            <Card className="overflow-hidden py-0">
              <CardContent className="divide-y divide-border p-0">
                {activeTherapyRows.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">Sin terapias activas</p>
                ) : (
                  activeTherapyRows.map((row) => (
                    <div key={row.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm">{row.contactName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {row.productTitle}
                          {row.sessions ? ` · ${row.sessions} sesiones` : ""}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </CrmPageShell>
  );
};

export default DashboardClient;
