"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/app/components/ui/button";

/**
 * Autoevaluaciones de antes de que existiera la lectura automática: la IA las
 * lee (cómo está, su hora, su país, el mensaje sugerido) sin escribirle a
 * nadie. Escribirle es decisión de Dayana, desde la ficha.
 */
const ReadPendingDiagnosticsButton = () => {
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/admin/diagnosticos/read-pending")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { pending?: number } | null) => setPending(d?.pending ?? null))
      .catch(() => undefined);
  }, []);

  const run = async () => {
    setBusy(true);
    setError(false);
    try {
      let left = pending ?? 1;
      for (let i = 0; i < 30 && left > 0; i++) {
        const res = await fetch("/api/admin/diagnosticos/read-pending", { method: "POST" });
        if (!res.ok) throw new Error();
        const d = (await res.json()) as { read: number; pending: number };
        left = d.pending;
        setPending(d.pending);
        if (d.read === 0) break;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (!pending) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm">
      <span>
        {pending} autoevaluación{pending === 1 ? "" : "es"} sin lectura de la IA (de antes de activarla). La IA las lee
        y deja el mensaje sugerido; no le escribe a nadie.
        {error ? <span className="text-[#b42318]"> No se pudo terminar, inténtalo de nuevo.</span> : null}
      </span>
      <Button size="sm" onClick={run} disabled={busy}>
        <Sparkles aria-hidden />
        {busy ? `Leyendo… quedan ${pending}` : "Leer pendientes con IA"}
      </Button>
    </div>
  );
};

export default ReadPendingDiagnosticsButton;
