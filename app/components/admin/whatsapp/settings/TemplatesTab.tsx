"use client";

import { ArrowRight, CheckCircle2, Clock, FileText, XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/app/components/ui/button";
import { SettingAnchor } from "./SettingRow";

export type TemplateCountsDto = { approved: number; pending: number; rejected: number };

/**
 * Pestaña «Plantillas»: un resumen y el camino a la pantalla de plantillas.
 * Las plantillas se gestionan allí; aquí solo se ve cómo están.
 */
const TemplatesTab = ({ counts }: { counts: TemplateCountsDto | null }) => (
  <SettingAnchor id="wa-templates">
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#00a884]/10 text-[#008069] dark:text-[#00a884]">
          <FileText className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Plantillas de mensajes</h2>
          <p className="text-xs text-muted-foreground">
            Lo que Meta aprueba para escribirle a quien no te escribió en las últimas 24 horas.
          </p>
        </div>
      </div>
      {counts ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 font-medium text-success">
            <CheckCircle2 className="size-4" aria-hidden /> {counts.approved} aprobadas
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 font-medium text-muted-foreground">
            <Clock className="size-4" aria-hidden /> {counts.pending} en revisión
          </span>
          {counts.rejected > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 font-medium text-destructive">
              <XCircle className="size-4" aria-hidden /> {counts.rejected} rechazadas
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sin datos en la vista previa.</p>
      )}
      <Button
        nativeButton={false}
        render={<Link href="/admin/whatsapp/plantillas" />}
        className="bg-[#00a884] text-white hover:bg-[#008069]"
      >
        Ver y crear plantillas <ArrowRight />
      </Button>
    </section>
  </SettingAnchor>
);

export default TemplatesTab;
