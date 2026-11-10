"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { whenLabel } from "@/lib/crm/call-funnel/rules";

import { useViewerZone } from "./MyCallHooks";
import { body, dangerBtn, h2, secondaryBtn, surface, tapLink } from "./MyCallUi";
import { SlotPicker } from "./SlotPicker";

type Props = {
  token: string;
  /** La hora que tiene ahora (el selector la marca). */
  startIso: string;
  fallbackTz: string;
  /** wa.me para cuando no se puede desde la página. */
  helpUrl: string;
};

type Mode = "idle" | "change" | "cancel";

/**
 * «¿No puedes a esa hora?»: cambiarla (el mismo selector de horas, que mueve
 * la cita: nunca quedan dos) o cancelarla, con un paso de confirmación en la
 * propia página.
 *
 * Después de cualquiera de las dos se vuelve a pedir la página al servidor
 * (`router.refresh()`): la hora de arriba, el mensaje de confirmación y los
 * enlaces del calendario salen de ahí, no de lo que el navegador cree.
 */
export const MyCallChange = ({ token, startIso, fallbackTz, helpUrl }: Props) => {
  const router = useRouter();
  const zone = useViewerZone(fallbackTz);
  const [mode, setMode] = useState<Mode>("idle");
  const [movedIso, setMovedIso] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<"closed" | "retry" | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const busy = posting || refreshing;

  // Lo que se abre queda a la vista (en el móvil aparece debajo del pliegue).
  useEffect(() => {
    if (mode !== "idle") panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [mode]);
  useEffect(() => {
    if (movedIso) noticeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [movedIso]);

  const open = (next: Mode) => {
    setError(null);
    setMovedIso(null);
    setMode((current) => (current === next ? "idle" : next));
  };

  const cancel = async () => {
    if (busy) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/llamada/${encodeURIComponent(token)}/cancelar`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { status?: string } | null;
      // `nothing`: ya no había una llamada por delante. `not_found`: el enlace
      // dejó de existir. En los tres casos el servidor dice qué mostrar.
      if (data?.status === "cancelled" || data?.status === "nothing" || data?.status === "not_found") {
        startRefresh(() => router.refresh());
      } else {
        setError(data?.status === "closed" ? "closed" : "retry");
      }
    } catch {
      setError("retry");
    } finally {
      setPosting(false);
    }
  };

  return (
    <section aria-labelledby="mi-llamada-cambiar" className="mt-12 border-t border-foreground/10 pt-10">
      <h2 id="mi-llamada-cambiar" className={h2}>
        ¿No puedes a esa hora?
      </h2>
      <p className={`mt-2 ${body}`}>Cámbiala o cancélala desde aquí. La hora que dejes queda libre para otra persona.</p>

      {movedIso ? (
        <p ref={noticeRef} role="status" className="mt-5 rounded-2xl border border-success/30 bg-success/10 px-4 py-3.5 font-[font1] text-[15px] leading-snug text-foreground">
          {`Tu llamada quedó para el ${whenLabel(movedIso, zone)}.`}
        </p>
      ) : null}

      {/* Cambiar pesa más que cancelar: quien mueve su hora sigue teniendo su llamada. */}
      <div className="mt-5 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-6">
        <button
          type="button"
          onClick={() => open("change")}
          aria-expanded={mode === "change"}
          disabled={busy}
          className={`${secondaryBtn} sm:w-auto`}
        >
          Cambiar la hora
        </button>
        <button type="button" onClick={() => open("cancel")} aria-expanded={mode === "cancel"} disabled={busy} className={tapLink}>
          Cancelar mi llamada
        </button>
      </div>

      {mode === "change" ? (
        <div ref={panelRef} className={`mt-5 scroll-mt-6 p-5 sm:p-6 ${surface}`}>
          <SlotPicker
            token={token}
            submitLabel="Cambiar a esta hora"
            currentStartIso={startIso}
            helpUrl={helpUrl}
            onBooked={(result) => {
              setMode("idle");
              setMovedIso(result.startIso);
              startRefresh(() => router.refresh());
            }}
          />
          <button type="button" onClick={() => setMode("idle")} className={`mt-3 ${tapLink}`}>
            Mantener mi hora
          </button>
        </div>
      ) : null}

      {mode === "cancel" ? (
        <div ref={panelRef} role="group" aria-labelledby="mi-llamada-cancelar" className={`mt-5 scroll-mt-6 p-5 sm:p-6 ${surface}`}>
          <p id="mi-llamada-cancelar" className="font-[font2] text-base leading-snug">
            ¿Cancelas tu llamada con Dayana?
          </p>
          <p className={`mt-1.5 ${body}`}>Sale de su agenda. Puedes elegir otra hora cuando quieras desde esta misma página.</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={cancel} disabled={busy} className={dangerBtn}>
              {busy ? "Cancelando…" : "Sí, cancelar"}
            </button>
            {/* El foco cae en la opción que no cambia nada. */}
            <button type="button" autoFocus onClick={() => setMode("idle")} disabled={busy} className={secondaryBtn}>
              No, mantenerla
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-4 font-[font1] text-[15px] leading-relaxed text-destructive">
              {error === "closed" ? "No pudimos cancelarla desde aquí. " : "No pudimos cancelarla ahora. Inténtalo de nuevo en un momento o "}
              <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                {error === "closed" ? "Escríbenos por WhatsApp" : "escríbenos por WhatsApp"}
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
