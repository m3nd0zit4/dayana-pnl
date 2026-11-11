"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCookieConsent } from "../../context/CookieConsentContext";

/**
 * El aviso de cookies: una tira pequeña abajo (dueño, 11-nov: «esa vaina está
 * muy grande… simplemente poner cookies y aceptar o no»). Una línea, dos
 * botones del mismo tamaño —rechazar y aceptar pesan lo mismo, como pide la
 * ley— y «Ajustar» para elegir por separado analítica y publicidad. Lo que es
 * cada cosa está en `/cookies`.
 */

const TOGGLES = [
  { key: "analytics", title: "Analítica", detail: "Medir qué páginas sirven (Vercel y Google Analytics)." },
  { key: "marketing", title: "Publicidad", detail: "Medir qué anuncio trajo a cada persona (Meta y Google)." },
] as const;

const btn =
  "font-[font1] min-h-9 rounded-full px-4 text-[13px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-linen/70";

const CookieConsentBanner = () => {
  const pathname = usePathname();
  const { status, acceptAll, rejectAll, savePreferences } = useCookieConsent();
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState({ analytics: false, marketing: false });

  if (pathname?.startsWith("/admin")) return null;
  if (status !== "unset") return null;

  return (
    <div
      role="dialog"
      aria-label="Cookies"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:justify-start sm:px-4 sm:pb-4"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/95 px-3 py-2.5 text-white shadow-lg shadow-black/40 backdrop-blur-md sm:w-auto">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 font-[font1] text-[13px] leading-snug text-white/80">
            <Link href="/cookies" className="underline decoration-white/30 underline-offset-2 hover:text-white">
              Cookies
            </Link>{" "}
            ·{" "}
            <button
              type="button"
              onClick={() => setCustomizing((v) => !v)}
              aria-expanded={customizing}
              className="underline decoration-white/30 underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-linen/70"
            >
              Ajustar
            </button>
          </p>
          <button type="button" onClick={rejectAll} className={`${btn} border border-white/25 text-white/90 hover:bg-white/10`}>
            Rechazar
          </button>
          <button type="button" onClick={acceptAll} className={`${btn} border border-linen bg-linen font-medium text-zinc-950 hover:bg-white`}>
            Aceptar
          </button>
        </div>

        {customizing && (
          <div className="mt-2.5 border-t border-white/10 pt-2.5">
            {TOGGLES.map((t) => (
              <label key={t.key} className="flex cursor-pointer items-start gap-2.5 py-1">
                <input
                  type="checkbox"
                  checked={draft[t.key]}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [t.key]: e.target.checked }))}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-linen"
                />
                <span className="font-[font1] text-[12px] leading-snug text-white/70">
                  <span className="text-white/90">{t.title}.</span> {t.detail}
                </span>
              </label>
            ))}
            <div className="mt-1.5 flex justify-end">
              <button type="button" onClick={() => savePreferences(draft)} className={`${btn} border border-white/25 text-white/90 hover:bg-white/10`}>
                Guardar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CookieConsentBanner;
