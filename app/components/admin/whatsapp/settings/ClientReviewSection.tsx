"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { SEGMENT_LABEL, SEGMENTS } from "@/lib/crm/whatsapp-agent/segment";
import { STAGE_HELP, STAGE_LABEL, STAGES } from "@/lib/crm/whatsapp-agent/stage";
import { useCrm } from "../../crm/CrmProvider";
import { useSettings } from "./context";
import SettingRow, { SettingsGroup } from "./SettingRow";

const API = "/api/admin/whatsapp/segments";

type ReviewItem = {
  conversationId: string;
  name: string;
  reason: string | null;
  evidence: { who: string; quote: string; at: string }[];
  summary: string;
};

type Data = { counts: Record<string, number>; stages?: Record<string, number>; review: ReviewItem[] };

/**
 * Quién es quién: cuántas nuevas, clientas, etc., y las que la IA trata como
 * clientas por duda (el chat dice que pagó, pero no está en el CRM). Dayana
 * confirma o descarta; mientras tanto la IA no les contesta.
 */
const ClientReviewSection = () => {
  const { preview } = useSettings();
  const { toast } = useCrm();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(API, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setData((await res.json()) as Data);
  }, []);

  useEffect(() => {
    if (!preview) void load();
  }, [load, preview]);

  const post = (body: unknown) =>
    fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);

  const computeAll = async () => {
    setBusy("compute");
    let computed = 0;
    try {
      for (;;) {
        const res = await post({ action: "compute" });
        const run = (await res?.json().catch(() => null)) as { computed?: number; remaining?: number } | null;
        if (!res?.ok || !run) {
          toast("Se cortó. Vuelve a intentarlo: sigue donde iba.", "error");
          return;
        }
        computed += run.computed ?? 0;
        setProgress(`${computed} chats revisados · faltan ${run.remaining ?? 0}`);
        if (!run.remaining || !run.computed) break;
      }
      await load();
      toast(`Listo: ${computed} chats revisados`, "success");
    } finally {
      setBusy(null);
    }
  };

  const mark = async (conversationId: string, isClient: boolean) => {
    setBusy(conversationId);
    try {
      const res = await post({ action: "mark", conversationId, isClient });
      if (!res?.ok) {
        toast("No se pudo guardar.", "error");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const counts = data?.counts ?? {};
  const stages = data?.stages ?? {};
  const hasStages = STAGES.some((s) => stages[s]);
  const summary = hasStages
    ? null
    : SEGMENTS.filter((s) => counts[s]).map((s) => `${SEGMENT_LABEL[s]}: ${counts[s]}`).join(" · ");

  return (
    <SettingsGroup
      title="Quién es quién"
      description="En qué punto está cada persona con Dayana: nueva, conversando, llamada agendada, no contestó, tuvo la llamada, clienta en proceso, ya fue clienta o personal. Se calcula con el CRM, la agenda y todo el chat."
    >
      <SettingRow
        id="wa-segments"
        label="Calcular para todos los chats"
        help={
          progress ??
          (hasStages ? "Se pone al día solo cada 10 minutos." : summary || "Aún sin calcular. Hazlo después de importar los chats y construir las fichas.")
        }
        layout="row"
      >
        <Button variant="outline" size="sm" onClick={() => void computeAll()} disabled={preview || busy !== null}>
          {busy === "compute" && <Loader2 className="size-4 animate-spin" />} Calcular
        </Button>
      </SettingRow>
      {hasStages && (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {STAGES.filter((s) => stages[s]).map((s) => (
            <li key={s} className="flex items-baseline justify-between gap-3 p-3">
              <span>
                <span className="font-medium">{STAGE_LABEL[s]}</span>
                <span className="block text-xs text-muted-foreground">{STAGE_HELP[s]}</span>
              </span>
              <span className="tabular-nums">{stages[s]}</span>
            </li>
          ))}
        </ul>
      )}
      <SettingRow
        id="wa-client-review"
        layout="stacked"
        label={`Clientas por revisar${data?.review.length ? ` (${data.review.length})` : ""}`}
        help="El chat sugiere que ya pagó (dice que transfirió, mandó un comprobante o la clasificación lo cree) pero no está en el CRM. Solo es clienta cuando tú lo confirmas: mientras tanto la IA la sigue atendiendo."
      >
        {data && data.review.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay nada por revisar.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {(data?.review ?? []).map((r) => (
              <li key={r.conversationId} className="space-y-1.5 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a href={`/admin/whatsapp?conversation=${r.conversationId}`} className="font-medium underline">
                    {r.name}
                  </a>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void mark(r.conversationId, true)}>
                      Es clienta
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void mark(r.conversationId, false)}>
                      No es clienta
                    </Button>
                  </div>
                </div>
                {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                {r.evidence.slice(-2).map((e) => (
                  <p key={`${e.at}-${e.quote}`} className="text-xs text-muted-foreground">
                    «{e.quote}» ({e.who === "dayana" ? "tú" : "ella"})
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </SettingRow>
    </SettingsGroup>
  );
};

export default ClientReviewSection;
