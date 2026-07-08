"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ExtractedWorkshopFields } from "@/lib/ai/workshop-extraction";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";

type Props = {
  onExtracted: (fields: ExtractedWorkshopFields) => void;
};

/**
 * Pega una descripción libre del taller (notas, boceto, mensaje de
 * WhatsApp) y Gemini extrae título, resumen, fecha, cronograma, temas y CTA.
 * Solo se muestra cuando aiEnabled (GEMINI_API_KEY configurada).
 */
const WorkshopSmartPasteBox = ({ onExtracted }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const input = text.trim();
    if (input.length < 10) {
      setError("Pega un poco más de texto para poder extraer datos.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai/extract-workshop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: input.slice(0, 8000) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        fields?: ExtractedWorkshopFields;
        error?: string;
      };
      if (!res.ok) {
        setError(
          data.error === "rate_limited" || data.error === "ai_quota"
            ? "Límite de IA alcanzado, intenta en un minuto."
            : "No se pudo extraer datos, revisa el texto o llena manual."
        );
        return;
      }
      const fields = data.fields ?? {};
      if (Object.keys(fields).length === 0) {
        setError("No se encontraron datos del taller en el texto.");
        return;
      }
      onExtracted(fields);
      setText("");
      setExpanded(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/40">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-purple-900"
        aria-expanded={expanded}
        onClick={() => setExpanded((s) => !s)}
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-4" />
          Autocompletar con IA — pega la descripción del taller
        </span>
        <ChevronDown
          className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          <Textarea
            className="min-h-[90px] bg-white"
            placeholder="Pega aquí notas, un boceto o un mensaje con los datos del taller (título, fecha, horario, temas, cronograma)…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              La IA sugiere; tú confirmas antes de guardar.
            </p>
            <Button size="sm" disabled={loading} onClick={() => void run()}>
              <Sparkles className="size-3.5" />
              {loading ? "Extrayendo…" : "Autocompletar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkshopSmartPasteBox;
