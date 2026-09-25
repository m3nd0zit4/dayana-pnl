"use client";

import UpcomingAppointments from "./UpcomingAppointments";
import { Settings2, Video } from "lucide-react";
import Link from "next/link";
import { Button } from "@/app/components/ui/button";
import type { WhatsAppBookingConfig } from "@/lib/crm/whatsapp-ai-config";
import CrmPageShell from "../crm/CrmPageShell";
import GoogleCalendarView from "./GoogleCalendarView";
import { useNow } from "./status";

export type BookingRow = {
  id: string;
  conversationId: string;
  name: string | null;
  phone: string;
  service: string;
  startsAt: string;
  meetUrl: string | null;
  status: string;
};

const BookingList = ({ rows }: { rows: BookingRow[] }) => (
  <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
    {rows.map((b) => (
      <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="w-52 shrink-0 font-medium capitalize">
          {new Date(b.startsAt).toLocaleString("es-CO", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {b.service} — {b.name ?? `+${b.phone}`}
        </span>
        {b.meetUrl && (
          <a href={b.meetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700 underline">
            <Video className="size-3.5" /> Meet
          </a>
        )}
        <Link href={`/admin/whatsapp?conversation=${b.conversationId}`} className="text-xs underline">
          Chat
        </Link>
      </li>
    ))}
  </ul>
);

/**
 * Las citas que agenda la IA. Las reglas (servicios, horario, respiro,
 * antelación) se cambian en Ajustes → Horarios y citas.
 */
const WhatsAppAgendaClient = ({
  initialBooking,
  bookings,
  canEdit,
  calendarAccounts,
}: {
  initialBooking: WhatsAppBookingConfig;
  bookings: BookingRow[];
  canEdit: boolean;
  calendarAccounts: number;
}) => {
  const now = useNow(true, 60_000);
  const past = bookings.filter((b) => new Date(b.startsAt).getTime() < now - 3600_000);

  return (
    <CrmPageShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <span className="text-xs text-muted-foreground">
          Tu agenda es tu Google Calendar: la IA agenda ahí directo, sin enlaces, y confirma con la persona antes.
        </span>
      </div>

      {calendarAccounts > 0 && <UpcomingAppointments canEdit={canEdit} />}

      {calendarAccounts === 0 && (
        <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          No hay Google Calendar conectado. Conéctalo en{" "}
          <Link href="/admin/ajustes/google" className="underline">
            Ajustes → Google
          </Link>{" "}
          para que la IA pueda agendar.
        </p>
      )}

      <GoogleCalendarView />

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Cómo agenda la IA</h2>
          <p className="text-xs text-muted-foreground">
            {initialBooking.enabled
              ? `Agenda sola · ${initialBooking.services.length} ${initialBooking.services.length === 1 ? "servicio" : "servicios"} · ${new Set(initialBooking.hours.map((h) => h.weekday)).size} días con horario`
              : "No agenda: te pasa las citas a ti."}
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href="/admin/whatsapp/ajustes?tab=citas" />}
          >
            <Settings2 /> Cambiar horarios y servicios
          </Button>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Citas pasadas</h2>
          <BookingList rows={past} />
        </section>
      )}
    </CrmPageShell>
  );
};

export default WhatsAppAgendaClient;
