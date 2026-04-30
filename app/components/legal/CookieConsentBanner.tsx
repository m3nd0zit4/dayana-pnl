"use client";

import Link from "next/link";
import { useCookieConsent } from "../../context/CookieConsentContext";

const CookieConsentBanner = () => {
  const { status, acceptAnalytics, rejectAnalytics } = useCookieConsent();

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
              Cookies necesarias para el sitio. Si aceptas, activamos{" "}
              <span className="text-white/90">Vercel Analytics</span> y{" "}
              <span className="text-white/90">Speed Insights</span> (uso
              agregado).{" "}
              <Link
                href="/cookies"
                className="text-linen underline decoration-linen/40 underline-offset-[3px] transition-colors hover:text-white hover:decoration-white/50"
              >
                Política de cookies
              </Link>
              .
            </p>
          </div>

          <div className="flex shrink-0 flex-row items-center justify-start gap-2 sm:gap-3 md:justify-end">
            <button
              type="button"
              onClick={rejectAnalytics}
              className="font-[font1] whitespace-nowrap rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-sm text-white/85 transition-colors hover:border-white/35 hover:bg-white/[0.06] sm:px-5"
            >
              Solo necesarias
            </button>
            <button
              type="button"
              onClick={acceptAnalytics}
              className="font-[font1] whitespace-nowrap rounded-lg bg-linen px-4 py-2.5 text-sm font-medium text-zinc-950 shadow-sm transition-colors hover:bg-white sm:px-5"
            >
              Aceptar analítica
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
