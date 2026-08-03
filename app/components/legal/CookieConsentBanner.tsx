"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCookieConsent } from "../../context/CookieConsentContext";

type Toggle = {
  key: "analytics" | "marketing";
  title: string;
  detail: string;
};

const TOGGLES: Toggle[] = [
  {
    key: "analytics",
    title: "Analítica",
    detail:
      "Uso agregado del sitio con Vercel Analytics, Speed Insights y Google Analytics. Nos dice qué páginas sirven y cuáles no.",
  },
  {
    key: "marketing",
    title: "Publicidad",
    detail:
      "Meta Pixel y Google Ads. Permite medir qué anuncio trajo a cada persona y mostrar anuncios a quienes ya visitaron el sitio.",
  },
];

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
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-desc"
      className="fixed inset-x-0 bottom-0 z-[100] px-3 sm:px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-6xl rounded-xl border border-white/[0.12] bg-zinc-950/95 shadow-[0_-12px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl ring-1 ring-white/[0.06]">
        <div className="flex flex-col gap-5 p-4 sm:p-5 md:flex-row md:items-center md:justify-between md:gap-8 lg:px-8 lg:py-5">
          <div className="min-w-0 flex-1 border-l-2 border-linen/40 pl-4 md:pl-5">
            <h2
              id="cookie-consent-title"
              className="font-[font2] uppercase text-[11px] sm:text-xs tracking-[0.28em] text-linen/90"
            >
              Privacidad · Cookies
            </h2>
            <p
              id="cookie-consent-desc"
              className="font-[font1] mt-2 text-sm leading-relaxed text-white/75 sm:text-[15px] sm:leading-relaxed"
            >
              Usamos cookies necesarias para que el sitio funcione. Con tu
              permiso añadimos <span className="text-white/90">analítica</span>{" "}
              (medir el uso) y{" "}
              <span className="text-white/90">publicidad</span> (Meta y Google,
              para medir campañas). Puedes elegir por separado.{" "}
              <Link
                href="/cookies"
                className="text-linen underline decoration-linen/40 underline-offset-[3px] transition-colors hover:text-white hover:decoration-white/50"
              >
                Política de cookies
              </Link>
              .
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3 md:justify-end">
            <button
              type="button"
              onClick={rejectAll}
              className="font-[font1] whitespace-nowrap rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-sm text-white/85 transition-colors hover:border-white/35 hover:bg-white/[0.06] sm:px-5"
            >
              Solo necesarias
            </button>
            <button
              type="button"
              onClick={() => setCustomizing((v) => !v)}
              aria-expanded={customizing}
              className="font-[font1] whitespace-nowrap rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-sm text-white/85 transition-colors hover:border-white/35 hover:bg-white/[0.06] sm:px-5"
            >
              Personalizar
            </button>
            <button
              type="button"
              onClick={acceptAll}
              className="font-[font1] whitespace-nowrap rounded-lg bg-linen px-4 py-2.5 text-sm font-medium text-zinc-950 shadow-sm transition-colors hover:bg-white sm:px-5"
            >
              Aceptar todo
            </button>
          </div>
        </div>

        {customizing && (
          <div className="border-t border-white/[0.12] p-4 sm:p-5 lg:px-8">
            <div className="flex flex-col gap-4">
              {TOGGLES.map((toggle) => (
                <label
                  key={toggle.key}
                  className="flex cursor-pointer items-start gap-3"
                >
                  <input
                    type="checkbox"
                    checked={draft[toggle.key]}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [toggle.key]: e.target.checked,
                      }))
                    }
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-linen"
                  />
                  <span className="min-w-0">
                    <span className="font-[font2] block uppercase text-[11px] tracking-[0.22em] text-linen/90">
                      {toggle.title}
                    </span>
                    <span className="font-[font1] mt-1 block text-[13px] leading-relaxed text-white/65">
                      {toggle.detail}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => savePreferences(draft)}
                className="font-[font1] whitespace-nowrap rounded-lg bg-linen px-5 py-2.5 text-sm font-medium text-zinc-950 shadow-sm transition-colors hover:bg-white"
              >
                Guardar preferencias
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CookieConsentBanner;
