"use client";

import { useState } from "react";

type Props = {
  /** Fecha hasta la que ya está pagado el acceso. */
  paidUntil: Date | null;
};

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "long",
  }).format(d);

/**
 * Cancelar la suscripción desde el portal.
 *
 * El mensaje es explícito en lo que más se malinterpreta: **cancelar detiene
 * la renovación, no el acceso ya pagado**. Sin decirlo, la gente asume que
 * pierde el mes que acaba de comprar y no cancela — o cancela y escribe
 * enfadada.
 */
const CancelSubscription = ({ paidUntil }: Props) => {
  const [state, setState] = useState<
    "idle" | "confirming" | "loading" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/miembros/subscription/cancel", {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setState("error");
        setError(
          data.error === "no_active_subscription"
            ? "No encontramos una suscripción activa en tu cuenta."
            : "No pudimos cancelar. Intenta de nuevo o escríbenos."
        );
        return;
      }
      setState("done");
    } catch {
      setState("error");
      setError("Error de red. Intenta de nuevo.");
    }
  };

  if (state === "done") {
    return (
      <p className="mt-3 text-sm leading-relaxed">
        Listo, tu suscripción no se renovará.
        {paidUntil ? (
          <> Conservas el acceso hasta el {formatDate(paidUntil)}.</>
        ) : null}
      </p>
    );
  }

  if (state === "confirming" || state === "loading") {
    return (
      <div className="mt-3 max-w-md">
        <p className="text-sm leading-relaxed">
          Si cancelas, no se te vuelve a cobrar.
          {paidUntil ? (
            <>
              {" "}
              <strong>Sigues entrando hasta el {formatDate(paidUntil)}</strong>,
              que es el mes que ya pagaste.
            </>
          ) : null}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={state === "loading"}
            onClick={() => void cancel()}
            className="cursor-pointer rounded-full border border-black/20 px-4 py-2 text-xs uppercase tracking-wide transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state === "loading" ? "Cancelando…" : "Sí, cancelar"}
          </button>
          <button
            type="button"
            disabled={state === "loading"}
            onClick={() => setState("idle")}
            className="cursor-pointer rounded-full bg-[#141118] px-4 py-2 text-xs uppercase tracking-wide text-linen transition-colors hover:bg-black disabled:opacity-60"
          >
            Mejor no
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setState("confirming")}
        className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
      >
        Cancelar suscripción
      </button>
      {state === "error" && error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default CancelSubscription;
