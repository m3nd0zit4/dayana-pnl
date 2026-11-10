"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

import { body, h2, secondaryBtn } from "./MyCallUi";

/**
 * «Guarda esta página»: esta dirección es la única forma de volver a la cita
 * (no hay cuenta ni contraseña). Copia el enlace; si el navegador no deja
 * (los de Instagram y TikTok a veces no), lo muestra para copiarlo a mano.
 *
 * La dirección se arma al tocar el botón, en el navegador: así el servidor no
 * la pinta y no hay nada que pueda diferir al hidratar.
 */
export const MyCallSaveLink = ({ token }: { token: string }) => {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [url, setUrl] = useState("");

  const copy = async () => {
    const href = `${window.location.origin}/llamada/${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(href);
      setState("copied");
    } catch {
      setUrl(href);
      setState("manual");
    }
  };

  return (
    <section aria-labelledby="mi-llamada-guardar" className="mt-12 border-t border-foreground/10 pt-10">
      <h2 id="mi-llamada-guardar" className={h2}>
        Guarda esta página
      </h2>
      <p className={`mt-2 ${body}`}>Con este enlace vuelves a ver tu llamada, cambiar la hora o cancelarla. Guárdalo donde lo encuentres.</p>

      {state === "manual" ? (
        <label className="mt-5 block">
          <span className="font-[font1] text-sm text-muted-foreground">Mantén presionado el enlace y elige «Copiar»:</span>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded-xl border border-input bg-card px-3.5 py-3 font-[font1] text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
        </label>
      ) : (
        <button type="button" onClick={copy} className={`mt-5 sm:w-auto ${secondaryBtn}`}>
          {state === "copied" ? <Check className="size-4 shrink-0" aria-hidden="true" /> : <Link2 className="size-4 shrink-0" aria-hidden="true" />}
          <span aria-live="polite">{state === "copied" ? "Enlace copiado" : "Copiar el enlace"}</span>
        </button>
      )}
    </section>
  );
};
