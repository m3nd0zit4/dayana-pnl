"use client";

import Link from "next/link";
import {
  ChevronRight,
  CircleCheck,
  MessageCircle,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardStats } from "@/lib/crm/dashboard-stats";
import type { Pendiente } from "@/lib/crm/pendientes";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { cn } from "@/lib/utils";
import DashboardDotBackground from "./DashboardDotBackground";
import { useCrm } from "./CrmProvider";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmPaymentsChart from "./CrmPaymentsChart";
import CrmPipelineChart from "./CrmPipelineChart";
import { CrmLoadingState } from "./ui";

/**
 * «Qué hay que hacer hoy»: lo primero de la portada.
 *
 * Cada fila es un número y un enlace a la pantalla donde se resuelve. Si no hay
 * nada, lo dice — una portada que sólo sabe avisar se deja de leer, y una que
 * calla cuando todo va bien obliga a revisar a mano.
 *
 * Las conversaciones sin responder sólo se enseñan con la bandeja encendida:
 * con el interruptor apagado su enlace llevaría a un 404.
 */
const PendientesList = ({ pendientes }: { pendientes: Pendiente[] }) => {
  const { metaInboxEnabled } = useCrm();
  const visible = pendientes.filter(
    (p) => p.key !== "conversaciones-sin-responder" || metaInboxEnabled
  );

  return (
    <section aria-labelledby="pendientes-title" className="space-y-3">
      <h2 id="pendientes-title" className="text-sm font-medium">
        Para hoy
      </h2>
      {visible.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-success" aria-hidden />
          Todo al día: no hay nada pendiente.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visible.map((p) => (
            <li key={p.key}>
              <Link
                href={p.href}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50"
              >
                <span
                  className={cn(
                    "min-w-8 rounded-md px-2 py-0.5 text-center text-sm font-semibold tabular-nums",
                    p.tone === "alert"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-foreground"
                  )}
                >
                  {p.count}
                </span>
                <span className="flex-1">{p.label}</span>
                <ChevronRight
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
};

const todayLabel = () => {
  const label = new Date().toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const StatItem = ({
  label,
  value,
  href,
}: {
  label: string;
  value: number | string;
  href?: string;
}) => {
  const body = (
    <>
      <span className="block text-xs whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <span className="mt-0.5 block text-lg font-semibold">{value}</span>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-md hover:underline">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
};

/**
 * Números y gráficas, siempre a la vista: Dayana los mira al entrar.
 *
 * Estuvieron plegados y dejaron de verse. Cada cifra dice su propio alcance
 * —no todas son «de los últimos 14 días»: leads, terapias y contactos son el
 * total, y los pagos son los de hoy—, así que el título es sólo «Números».
 */
const NumbersSection = ({ data }: { data: DashboardStats }) => {
  const { stats } = data;
  // El enlace sólo para quien puede entrar: Estadísticas es de OWNER y a los
  // demás les devolvería a Inicio.
  const { canManageTeam } = useCrm();

  return (
    <section aria-labelledby="numeros-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="numeros-title" className="text-sm font-medium">
          Números
        </h2>
        {canManageTeam ? (
          <Link
            href="/admin/estadisticas"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Ver todas las estadísticas
          </Link>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-6 rounded-lg border border-border bg-card px-4 py-3 sm:gap-8">
        <StatItem label="Leads y pagos pendientes" value={stats.leads} />
        <StatItem
          label="Pagos de hoy"
          value={stats.paymentsToday}
          href="/admin/payments"
        />
        <StatItem label="Terapias activas" value={stats.activeTherapies} />
        <StatItem
          label="Contactos en total"
          value={stats.contacts}
          href="/admin/contacts"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CrmPaymentsChart data={data.paymentsByDay} />
        <CrmPipelineChart data={data.pipeline} />
      </div>
    </section>
  );
};

export type WhatsAppHomeSummary = {
  /** Mensajes sin leer en chats de WhatsApp abiertos. */
  unread: number;
  /** Chats en «Te toca»: necesitan a Dayana (salen en cuanto ella contesta). */
  handedOff: number;
  aiEnabled: boolean;
};

/**
 * La puerta a WhatsApp, lo primero de la portada: es donde escriben los
 * clientes y donde la IA avisa cuando algo le toca a Dayana.
 */
const WhatsAppHomeButton = ({ summary }: { summary: WhatsAppHomeSummary }) => {
  const detail = [
    summary.unread > 0 ? `${summary.unread} sin leer` : "Sin mensajes nuevos",
    summary.handedOff > 0
      ? `${summary.handedOff} ${summary.handedOff === 1 ? "te espera" : "te esperan"}`
      : null,
    summary.aiEnabled ? "Asistente activo" : "Asistente apagado",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href="/admin/whatsapp"
      className="flex items-center gap-3 rounded-lg bg-success px-4 py-3 text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <MessageCircle className="size-6 shrink-0" aria-hidden />
      <span className="flex-1">
        <span className="block text-base font-semibold">WhatsApp</span>
        <span className="block text-sm opacity-90">{detail}</span>
      </span>
      {summary.unread > 0 && (
        <span className="min-w-7 rounded-full bg-background px-2 py-0.5 text-center text-sm font-semibold text-success tabular-nums">
          {summary.unread}
        </span>
      )}
      <ChevronRight className="size-5 shrink-0" aria-hidden />
    </Link>
  );
};

type Props = {
  initialData?: DashboardStats | null;
  dbError?: boolean;
  /** Nulo cuando WhatsApp no está conectado: no se enseña el botón. */
  whatsapp?: WhatsAppHomeSummary | null;
};

/**
 * La portada del panel: el saludo, «Para hoy» y, plegado, los números.
 *
 * Antes abría con cuatro cifras sin enlace, las gráficas y tres tarjetas que
 * repetían entradas del menú; lo que había que hacer hoy quedaba en medio.
 */
const DashboardClient = ({
  initialData,
  dbError = false,
  whatsapp = null,
}: Props) => {
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
        <CrmPageHeader title="Inicio" />
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
        <CrmPageHeader title="Inicio" />
        <CrmLoadingState rows={4} />
      </CrmPageShell>
    );
  }

  return (
    <CrmPageShell>
      <CrmPageHeader title={greeting()} description={todayLabel()} />
      <div className="relative flex flex-col gap-8">
        <DashboardDotBackground />
        {whatsapp && <WhatsAppHomeButton summary={whatsapp} />}
        <PendientesList pendientes={data.pendientes} />
        <NumbersSection data={data} />
      </div>
    </CrmPageShell>
  );
};

export default DashboardClient;
