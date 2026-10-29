"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { useCrm } from "../CrmProvider";
import { CrmDataList, CrmDataListRow } from "../ui";

/** Lo que manda la página (`listWorkshopTemplates`): una plantilla del taller y cómo está en Meta. */
export type WorkshopTemplateRowView = {
  key: string;
  title: string;
  purpose: string;
  state: {
    kind: string;
    label: string;
    detail: string;
    tone: "ok" | "warn" | "info";
    submittable: boolean;
  };
};

const TONE_TEXT: Record<WorkshopTemplateRowView["state"]["tone"], string> = {
  ok: "text-success",
  warn: "text-warning",
  info: "text-muted-foreground",
};
const TONE_BADGE: Record<WorkshopTemplateRowView["state"]["tone"], string> = {
  ok: "border-success/30 text-success",
  warn: "border-warning/30 text-warning",
  info: "",
};

const readMessage = async (res: Response | null, fallback: string) => {
  const data = (await res?.json().catch(() => null)) as { message?: string } | null;
  return data?.message || fallback;
};

/**
 * Las plantillas de WhatsApp del taller en «Interesadas» (29-oct): la del
 * registro en la página (Utilidad) y la de la invitación a inscritas de eventos
 * gratuitos (Marketing). La del registro solo se mandaba a Meta con el primer
 * registro de alguien que no escribió en 24 h, así que a los primeros no les
 * llegaba nada. Aquí se ve cómo está cada una en Meta y la dueña las manda a
 * aprobar con un toque (las que nunca se mandaron o Meta rechazó).
 */
const WorkshopTemplatesStatus = ({ slug, templates: initial }: { slug: string; templates: WorkshopTemplateRowView[] }) => {
  const { role, toast } = useCrm();
  const router = useRouter();
  const [templates, setTemplates] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const isOwner = role === "OWNER";
  const missing = templates.filter((t) => t.state.submittable);

  const submit = async () => {
    setSubmitting(true);
    const res = await fetch(`/api/admin/workshops/${encodeURIComponent(slug)}/templates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "submit", keys: missing.map((t) => t.key) }),
    }).catch(() => null);
    setSubmitting(false);
    if (!res?.ok) {
      toast(await readMessage(res, "No se pudo mandar a aprobar. Inténtalo de nuevo."), "error");
      return;
    }
    const data = (await res.json()) as {
      results: { key: string; status: "submitted" | "already" | "failed"; error?: string }[];
      templates: WorkshopTemplateRowView[];
    };
    setTemplates(data.templates);
    const sent = data.results.filter((r) => r.status === "submitted").length;
    const failed = data.results.filter((r) => r.status === "failed");
    if (failed.length > 0) toast(`Una no llegó a Meta: ${failed[0].error ?? "inténtalo de nuevo"}.`, "error");
    else toast(sent > 0 ? "Enviada a Meta: el CRM revisa solo cuándo la aprueban." : "Ya estaban en revisión en Meta.");
    router.refresh();
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4" data-testid="taller-plantillas">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-sm font-medium">Plantillas de WhatsApp del taller</h2>
          <p className="text-xs text-muted-foreground">
            Para escribirle a quien no escribió en las últimas 24 h, WhatsApp pide una plantilla aprobada por Meta. Mandarla a revisión no
            cuesta; Meta cobra cada mensaje que sale con ella.
          </p>
        </div>
        {isOwner && missing.length > 0 ? (
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => void submit()}>
            <BadgeCheck aria-hidden />
            {submitting ? "Mandando…" : missing.length === 1 ? "Mandar a aprobar" : `Mandar las ${missing.length} a aprobar`}
          </Button>
        ) : null}
      </div>
      <CrmDataList>
        {templates.map((t) => (
          <CrmDataListRow key={t.key}>
            <div className="min-w-0 flex-1 basis-56">
              <p className="font-medium">{t.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.purpose}</p>
              <p className={`mt-0.5 text-xs ${TONE_TEXT[t.state.tone]}`}>{t.state.detail}</p>
            </div>
            <Badge variant="outline" className={TONE_BADGE[t.state.tone]}>
              {t.state.label}
            </Badge>
          </CrmDataListRow>
        ))}
      </CrmDataList>
      {!isOwner && missing.length > 0 ? <p className="text-xs text-muted-foreground">Solo la dueña puede mandarlas a aprobar.</p> : null}
    </section>
  );
};

export default WorkshopTemplatesStatus;
