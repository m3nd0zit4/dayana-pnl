"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";
import type { GeneratedModuleContent } from "@/lib/ai/module-generation";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";

type Props = {
  onGenerated: (content: GeneratedModuleContent) => void;
};

/**
 * Describe el tema del módulo en pocas palabras y Gemini redacta el
 * contenido completo en Markdown (título sugerido + cuerpo). Solo se
 * muestra cuando aiEnabled (GEMINI_API_KEY configurada).
 */
const ModuleAiGenerateBox = ({ onGenerated }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const input = prompt.trim();
    if (input.length < 4) {
      setError("Describe el tema con un poco más de detalle.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai/generate-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: input }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        content?: GeneratedModuleContent;
        error?: string;
      };
      if (!res.ok || !data.content) {
        setError(
          data.error === "rate_limited" || data.error === "ai_quota"
            ? "Límite de IA alcanzado, intenta en un minuto."
            : "No se pudo generar el contenido, intenta de nuevo."
        );
        return;
      }
      onGenerated(data.content);
      setPrompt("");
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
          Generar contenido con IA
        </span>
        <ChevronDown
          className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          <Textarea
            className="min-h-[70px] bg-white"
            placeholder="Describe el tema del módulo, ej. «Anclajes emocionales: qué son y cómo crear uno propio»…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              La IA redacta un borrador; revísalo antes de publicar.
            </p>
            <Button size="sm" disabled={loading} onClick={() => void run()}>
              <Sparkles className="size-3.5" />
              {loading ? "Generando…" : "Generar contenido"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModuleAiGenerateBox;
