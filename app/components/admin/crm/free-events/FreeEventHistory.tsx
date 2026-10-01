import Link from "next/link";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import type { FreeEventTimeline } from "@/lib/crm/free-events";
import type { FlagSummary, TimelineItem } from "@/lib/crm/free-event-rules";
import { cn } from "@/lib/utils";
import { CrmEmptyState } from "../ui";

type Props = {
  timeline: FreeEventTimeline;
  timeZone: string;
};

const dateTime = (d: Date, timeZone: string) =>
  d.toLocaleString("es-CO", { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const day = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-CO", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
};

const range = (s: FlagSummary, timeZone: string): string | null => {
  if (!s.first || !s.last) return null;
  const a = dateTime(s.first, timeZone);
  const b = dateTime(s.last, timeZone);
  return a === b ? a : `${a} → ${b}`;
};

const DOT: Record<TimelineItem["tone"], string> = {
  default: "bg-terracotta",
  success: "bg-success",
  warning: "bg-warning",
  muted: "bg-muted-foreground/50",
};

/**
 * Inscripciones por día: barras simples, sin librería de gráficas. Cada barra
 * dice su día y su número al pasar el dedo (o el ratón).
 */
const PerDayBars = ({ perDay }: { perDay: FreeEventTimeline["perDay"] }) => {
  const max = Math.max(1, ...perDay.map((p) => p.count));
  return (
    <div>
      <div className="flex h-20 items-end gap-px" role="img" aria-label="Inscripciones por día">
        {perDay.map((p) => (
          <div
            key={p.day}
            title={`${day(p.day)}: ${p.count}`}
            className={cn("min-w-[3px] flex-1 rounded-t-sm", p.count > 0 ? "bg-terracotta/70" : "bg-muted")}
            style={{ height: `${Math.max(4, Math.round((p.count / max) * 100))}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{day(perDay[0].day)}</span>
        <span>máx. {max}/día</span>
        <span>{day(perDay[perDay.length - 1].day)}</span>
      </div>
    </div>
  );
};

/**
 * La pestaña «Historia»: cómo fue el evento de principio a fin. Inscripciones
 * por día, cuánto salió de cada envío y cuándo, y la línea de tiempo (lo que
 * pasó, los envíos de WhatsApp y las pasadas del reloj, juntas si van seguidas).
 */
const FreeEventHistory = ({ timeline, timeZone }: Props) => {
  const { flags, registrations, perDay, items } = timeline;
  const flagRows: [string, FlagSummary][] = [
    ["Correo con el enlace", flags.link],
    ["Correo 24 h antes", flags.reminder24h],
    ["Correo 1 h antes", flags.reminder1h],
    ["WhatsApp al inscribirse", flags.waConfirmation],
    ["WhatsApp 24 h antes", flags.wa24h],
    ["WhatsApp 1 h antes", flags.wa1h],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base uppercase tracking-wide">Inscripciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            <strong className="text-2xl font-semibold tabular-nums">{registrations.toLocaleString("es-CO")}</strong>{" "}
            <span className="text-muted-foreground">{registrations === 1 ? "persona inscrita" : "personas inscritas"}</span>
          </p>
          {perDay.length > 0 ? <PerDayBars perDay={perDay} /> : null}
        </CardContent>
      </Card>

      {registrations > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-wide">Lo que les llegó</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              {flagRows.map(([label, s]) => (
                <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                  <dt className="text-sm">{label}</dt>
                  <dd className="ml-auto text-right text-sm tabular-nums">
                    <span className="font-medium">{s.count.toLocaleString("es-CO")}</span>
                    <span className="text-muted-foreground">/{registrations.toLocaleString("es-CO")}</span>
                    {range(s, timeZone) ? (
                      <span className="block text-[11px] text-muted-foreground">{range(s, timeZone)}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
            {flags.waErrors > 0 ? (
              <p className="mt-2 text-xs text-warning">
                {flags.waErrors.toLocaleString("es-CO")} con un recordatorio de WhatsApp que no salió (míralas en «Inscritas»).
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base uppercase tracking-wide">Historia</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <CrmEmptyState icon={History} title="Todavía no pasó nada" description="Aquí aparecerá cuándo se publicó, los envíos y los recordatorios." />
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {items.map((it) => (
                <li key={it.key} className="relative">
                  <span
                    aria-hidden
                    className={cn("absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-card", DOT[it.tone])}
                  />
                  <p className="text-sm font-medium leading-snug">
                    {it.sendId ? (
                      <Link href={`/admin/whatsapp/envios?id=${it.sendId}`} className="hover:underline">
                        {it.title}
                      </Link>
                    ) : (
                      it.title
                    )}
                  </p>
                  {it.count != null || it.failed ? (
                    <p className="text-xs tabular-nums">
                      {it.count != null ? (
                        <span className="text-foreground">
                          {it.count.toLocaleString("es-CO")}{" "}
                          {it.kind.startsWith("meet_link")
                            ? "vuelven a la cola"
                            : it.count === 1
                              ? "enviado"
                              : "enviados"}
                        </span>
                      ) : null}
                      {it.failed ? (
                        <span className="text-warning"> · {it.failed.toLocaleString("es-CO")} no salieron</span>
                      ) : null}
                      {it.runs > 1 ? <span className="text-muted-foreground"> · {it.runs} pasadas</span> : null}
                    </p>
                  ) : null}
                  {it.detail ? <p className="text-xs text-muted-foreground">{it.detail}</p> : null}
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {it.approximate ? "≈ " : ""}
                    {dateTime(it.at, timeZone)}
                    {it.until ? ` → ${dateTime(it.until, timeZone)}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FreeEventHistory;
