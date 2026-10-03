import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import type { FreeEventTimeline } from "@/lib/crm/free-events";
import type { FlagSummary } from "@/lib/crm/free-event-rules";
import EditionTimeline, { EditionDeliveries, PerDayBars } from "../editions/EditionTimeline";

type Props = {
  timeline: FreeEventTimeline;
  timeZone: string;
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
          <PerDayBars perDay={perDay} />
        </CardContent>
      </Card>

      {registrations > 0 ? (
        <EditionDeliveries
          rows={flagRows}
          total={registrations}
          timeZone={timeZone}
          warning={
            flags.waErrors > 0
              ? `${flags.waErrors.toLocaleString("es-CO")} con un recordatorio de WhatsApp que no salió (míralas en «Inscritas»).`
              : null
          }
        />
      ) : null}

      <EditionTimeline items={items} timeZone={timeZone} />
    </div>
  );
};

export default FreeEventHistory;
