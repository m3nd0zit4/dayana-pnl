"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ExtractedContactFields } from "@/lib/ai/contact-extraction";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";

type Props = {
  onExtracted: (fields: ExtractedContactFields) => void;
  /** Texto pegado en otro campo que dispara la oferta de autocompletar. */
  pendingText?: string | null;
  onConsumePendingText?: () => void;
};

/**
 * Caja de "pegado inteligente": el staff pega un chat de WhatsApp o texto
 * libre y Gemini extrae nombre, teléfono, país, email, origen y notas.
 * Solo se muestra cuando aiEnabled (GEMINI_API_KEY configurada).
 */
const SmartPasteBox = ({ onExtracted, pendingText, onConsumePendingText }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveExpanded = expanded || Boolean(pendingText);
  const effectiveText = text || pendingText || "";

  const run = async () => {
    const input = effectiveText.trim();
    if (input.length < 10) {
      setError("Pega un poco más de texto para poder extraer datos.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai/extract-contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: input.slice(0, 8000) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        fields?: ExtractedContactFields;
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
        setError("No se encontraron datos de contacto en el texto.");
        return;
      }
      onExtracted(fields);
      setText("");
      setExpanded(false);
      onConsumePendingText?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/40">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-purple-900"
        aria-expanded={effectiveExpanded}
        onClick={() => setExpanded((s) => !s)}
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-4" />
          Autocompletar con IA — pega el chat de WhatsApp
        </span>
        <ChevronDown
          className={`size-4 transition-transform ${effectiveExpanded ? "rotate-180" : ""}`}
        />
      </button>
      {effectiveExpanded && (
        <div className="space-y-2 px-3 pb-3">
          <Textarea
            className="min-h-[90px] bg-white"
            placeholder="Pega aquí la conversación de WhatsApp o cualquier texto con los datos del contacto…"
            value={effectiveText}
            onChange={(e) => {
              setText(e.target.value);
              if (pendingText) onConsumePendingText?.();
            }}
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

export default SmartPasteBox;
