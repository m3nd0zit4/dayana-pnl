"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getSession, useSession } from "next-auth/react";
import type { Plan } from "../../../lib/plans";
import PlanCheckoutButtons from "../payments/PlanCheckoutButtons";
import { useCheckoutModal } from "../../context/CheckoutModalContext";
import MemberSignInForm from "../miembros/MemberSignInForm";
import OnboardingWizard from "../miembros/OnboardingWizard";

type Provider = "paypal" | "mercadopago";

type WorkshopCheckoutCtaProps = {
  plan: Plan;
  userCountry?: string | null;
  isDark: boolean;
  googleEnabled: boolean;
  /** Path of the page hosting this CTA — the Google OAuth leg returns here
   *  with ?autopay=<planId> to resume the checkout. */
  autopayReturnPath: string;
};

/**
 * The single path to pay for a workshop: renders the country's payment
 * button; with a session it opens the checkout straight away (sessionFirst —
 * the contact step is skipped when we already know the person), without one
 * it overlays login/onboarding right here and continues into the payment
 * once the session exists. No navigation at any point except Google OAuth,
 * which returns via ?autopay.
 */
const WorkshopCheckoutCta = ({
  plan,
  userCountry,
  isDark,
  googleEnabled,
  autopayReturnPath,
}: WorkshopCheckoutCtaProps) => {
  const { status } = useSession();
  const { openCheckout: openCheckoutModal } = useCheckoutModal();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [authOverlay, setAuthOverlay] = useState<null | {
    provider: Provider;
    mode: "wizard" | "login";
    email?: string;
  }>(null);
  const pendingProviderRef = useRef<Provider | null>(null);
  const autopayTriggeredRef = useRef(false);

  const providerForCountry: Provider =
    userCountry === "CO" ? "mercadopago" : "paypal";
  const callbackUrl = `${autopayReturnPath}?autopay=${encodeURIComponent(plan.id)}`;

  const openCheckout = (provider: Provider) => {
    openCheckoutModal(plan.id, provider);
  };

  const handlePay = (provider: Provider) => {
    if (status === "authenticated") {
      openCheckout(provider);
      return;
    }
    if (status === "loading") {
      // Don't flash the auth overlay at someone who is actually logged in —
      // resolve the session once and act on the truth.
      pendingProviderRef.current = provider;
      void getSession()
        .catch(() => null)
        .then((session) => {
          const pending = pendingProviderRef.current;
          pendingProviderRef.current = null;
          if (!pending) return;
          if (session?.user) {
            openCheckout(pending);
          } else {
            setAuthOverlay({ provider: pending, mode: "wizard" });
          }
        });
      return;
    }
    setAuthOverlay({ provider, mode: "wizard" });
  };

  const continueAfterAuth = (provider: Provider) => {
    setAuthOverlay(null);
    // Refresh the client session cache, then continue into the checkout —
    // the server resolves the contact from the fresh cookie either way.
    void getSession().finally(() => openCheckout(provider));
  };

  // Google OAuth return leg: ?autopay=<planId> (or legacy "1") re-opens the
  // checkout once, then strips the param so refresh/back don't re-trigger.
  useEffect(() => {
    if (autopayTriggeredRef.current) return;
    const autopay = searchParams.get("autopay");
    if (autopay !== plan.id && autopay !== "1") return;
    autopayTriggeredRef.current = true;

    openCheckout(providerForCountry);

    const cleaned = new URLSearchParams(searchParams);
    cleaned.delete("autopay");
    const query = cleaned.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
    // Mount-only by design (same pattern as the old WorkshopPaymentSection):
    // must fire once per navigation, not on every dependency change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlay =
    authOverlay && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Crea tu cuenta o inicia sesión para pagar"
            onClick={(e) => {
              if (e.target === e.currentTarget) setAuthOverlay(null);
            }}
          >
            <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-linen/15 bg-black p-6 sm:p-7">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-white/60">
                    Inscripción
                  </div>
                  <p className="font-[font1] mt-2 text-lg leading-snug text-white/85">
                    {authOverlay.mode === "wizard"
                      ? "Crea tu cuenta para continuar con el pago."
                      : "Inicia sesión para continuar con el pago."}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar"
                  onClick={() => setAuthOverlay(null)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-linen/25 text-white/70 transition-colors hover:border-linen/50 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {authOverlay.mode === "wizard" ? (
                <>
                  <OnboardingWizard
                    callbackUrl={callbackUrl}
                    onComplete={() => continueAfterAuth(authOverlay.provider)}
                    onSwitchToLogin={(email) =>
                      setAuthOverlay({ ...authOverlay, mode: "login", email })
                    }
                  />
                  <p className="mt-5 text-center font-[font1] text-[13px] text-white/45">
                    ¿Ya tienes cuenta?{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setAuthOverlay({ ...authOverlay, mode: "login" })
                      }
                      className="text-linen underline-offset-4 hover:underline"
                    >
                      Inicia sesión
                    </button>
                  </p>
                </>
              ) : (
                <MemberSignInForm
                  googleEnabled={googleEnabled}
                  callbackUrl={callbackUrl}
                  initialEmail={authOverlay.email}
                  onSuccess={() => continueAfterAuth(authOverlay.provider)}
                  onSwitchToSignup={() =>
                    setAuthOverlay({ ...authOverlay, mode: "wizard" })
                  }
                />
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <PlanCheckoutButtons
        plan={plan}
        isDark={isDark}
        userCountry={userCountry}
        showWhatsApp={false}
        onPay={handlePay}
      />
      {overlay}
    </>
  );
};

export default WorkshopCheckoutCta;
