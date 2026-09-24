"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Clock, MapPin, MessageCircle, Sparkles } from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import type { DiagnosticAnalysis } from "@/lib/crm/diagnostic-outreach";

const STATUS: Record<string, string> = {
  ANALYZING: "La IA la está leyendo…",
  SENT: "Se le escribió por WhatsApp",
  AWAITING_APPROVAL: "El mensaje espera tu aprobación en el chat",
  DRAFT: "Quedó el borrador en el chat",
  NEEDS_TEMPLATE: "No se envió: falta aprobar la plantilla",
  SKIPPED: "No se le escribió",
  FAILED: "No se pudo enviar",
};

const CARE: Record<string, { label: string; className: string }> = {
  urgente: { label: "Urgente", className: "bg-[#fde2e1] text-[#b42318]" },
  atento: { label: "Con cuidado", className: "bg-[#fff4d6] text-[#8a5a00]" },
  normal: { label: "Tranquila", className: "bg-[#e7f6ec] text-[#067647]" },
};

type Props = {
  diagnosticId: string;
  analysis: DiagnosticAnalysis | null;
  status: string | null;
  reason: string | null;
  at: string | null;
  conversationId: string | null;
  hasPhone: boolean;
};

/** Lo que la IA leyó de la autoevaluación y el primer WhatsApp que se le mandó. */
const DiagnosticOutreachCard = ({ diagnosticId, analysis, status, reason, conversationId, hasPhone }: Props) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writeNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/diagnosticos/${diagnosticId}/whatsapp`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { status?: string; reason?: string };
      if (!res.ok || (data.status && data.status !== "SENT")) setError(data.reason ?? "No se pudo enviar.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const care = analysis ? CARE[analysis.care] : null;
  const s = analysis?.signals;
  const canWrite = hasPhone && status !== "SENT" && status !== "ANALYZING";

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-[#008069]" aria-hidden />
          <h2 className="font-semibold">Lectura de la IA</h2>
          {care ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${care.className}`}>{care.label}</span> : null}
          {s ? (
            <Badge variant="outline" className="gap-1">
              <Clock className="size-3" aria-hidden />
              {s.localWeekday} {s.localTime} hora suya{s.lateNight ? " · madrugada" : ""}
            </Badge>
          ) : null}
          {s?.livesInName ? (
            <Badge variant="outline" className="gap-1">
              <MapPin className="size-3" aria-hidden />
              {[s.ipCity, s.livesInName].filter(Boolean).join(", ")}
              {s.abroad ? " · vive fuera de su país" : ""}
            </Badge>
          ) : null}
        </div>

        {analysis ? (
          <div className="space-y-2 text-sm">
            {analysis.feeling ? <p>{analysis.feeling}</p> : null}
            {analysis.timeContext ? <p className="text-muted-foreground">{analysis.timeContext}</p> : null}
            {analysis.care !== "normal" && analysis.careReason ? (
              <p className="text-muted-foreground">Por qué: {analysis.careReason}</p>
            ) : null}
            {analysis.insights.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5">
                {analysis.insights.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
            {analysis.suggestionForDayana ? (
              <p>
                <span className="font-medium">Cómo abordarla: </span>
                {analysis.suggestionForDayana}
              </p>
            ) : null}
            <p className="rounded-lg bg-[#d9fdd3] px-3 py-2 whitespace-pre-wrap text-[#111b21]">{analysis.message}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {status === "ANALYZING" ? "La IA la está leyendo…" : "Todavía no hay lectura de la IA."}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {status ? (
            <span className={status === "SENT" ? "text-[#008069]" : "text-muted-foreground"}>
              {STATUS[status] ?? status}
              {reason && status !== "SENT" ? ` — ${reason}` : ""}
            </span>
          ) : null}
          <span className="flex-1" />
          {conversationId ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/admin/whatsapp?conversation=${conversationId}`} />}>
              <MessageCircle aria-hidden />
              Abrir chat
            </Button>
          ) : null}
          {canWrite ? (
            <Button size="sm" onClick={writeNow} disabled={busy}>
              {busy ? "Escribiendo…" : analysis ? "Escribirle ahora" : "Leer y escribirle"}
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      </CardContent>
    </Card>
  );
};

export default DiagnosticOutreachCard;
