import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import type { WorkshopTimeline } from "@/lib/crm/workshop-panel";
import EditionTimeline, { EditionDeliveries, PerDayBars } from "../editions/EditionTimeline";

/**
 * La pestaña «Historia» de un taller, como la de un evento: pagos por día, qué
 * recordatorios llegaron y la línea de tiempo (creado, publicado, precio y
 * fecha cambiados, envíos de WhatsApp, pasadas del reloj, terminado).
 */
const WorkshopHistory = ({ timeline, timeZone }: { timeline: WorkshopTimeline; timeZone: string }) => {
  const { flags, enrollments, perDay, items } = timeline;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base uppercase tracking-wide">Inscripciones pagadas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            <strong className="text-2xl font-semibold tabular-nums">{enrollments.toLocaleString("es-CO")}</strong>{" "}
            <span className="text-muted-foreground">{enrollments === 1 ? "persona pagó" : "personas pagaron"}</span>
          </p>
          <PerDayBars perDay={perDay} label="Pagos por día" />
        </CardContent>
      </Card>

      {enrollments > 0 ? (
        <EditionDeliveries
          rows={[
            ["Correo 24 h antes", flags.email24h],
            ["Correo 1 h antes", flags.email1h],
            ["WhatsApp 24 h antes", flags.wa24h],
            ["WhatsApp 1 h antes", flags.wa1h],
          ]}
          total={enrollments}
          timeZone={timeZone}
          warning={
            flags.waErrors > 0
              ? `${flags.waErrors.toLocaleString("es-CO")} con un recordatorio de WhatsApp que no salió (míralas en «Inscritas»).`
              : null
          }
        />
      ) : null}

      <EditionTimeline
        items={items}
        timeZone={timeZone}
        emptyDescription="Aquí aparecerá cuándo se publicó, los cambios de fecha y precio, los envíos y los recordatorios."
      />
    </div>
  );
};

export default WorkshopHistory;
