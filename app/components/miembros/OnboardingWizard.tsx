"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import type { CountryCode } from "libphonenumber-js";
import {
  getLocalPhonePlaceholder,
  sanitizeLocalPhoneInput,
  validateLocalPhone,
} from "@/lib/phone";
import CheckoutCountrySelect from "../payments/CheckoutCountrySelect";

const inputClass =
  "w-full rounded-xl border border-linen/20 bg-black/30 px-4 py-3.5 font-[font1] text-sm text-white placeholder-white/30 transition-colors focus:border-terracotta focus:outline-none";

const labelClass =
  "mb-2 block font-[font2] uppercase text-[10px] tracking-[0.22em] text-white/50";

const PASSWORD_MIN_LENGTH = 12;

const STEPS = ["Correo", "Nombre", "WhatsApp", "Contraseña"] as const;
type StepIndex = 0 | 1 | 2 | 3;

type OnboardingWizardProps = {
  /** Same-site path to land on (or continue to) once the account exists. */
  callbackUrl?: string;
  /** Inline embeds (checkout overlay): called after signup + sign-in instead
   *  of navigating away. */
  onComplete?: () => void;
  /** The email already has a working account — flip the host UI to login
   *  (also used when the email is a Google-only account: Google sign-IN
   *  still works, just not from this creation wizard — see auth.ts). */
  onSwitchToLogin?: (email: string) => void;
};

/**
 * Multi-step signup: one question at a time (email → nombre → WhatsApp →
 * contraseña), branded like the rest of the auth surfaces. Creates the
 * account directly (POST /api/miembros/auth/signup) and signs in — no
 * emailed link, no Google, in this path.
 */
const OnboardingWizard = ({
  callbackUrl,
  onComplete,
  onSwitchToLogin,
}: OnboardingWizardProps) => {
  const [step, setStep] = useState<StepIndex>(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("CO");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const destination = callbackUrl ?? "/miembros";

  const goTo = (next: StepIndex) => {
    setError(null);
    setDirection(next >= step ? 1 : -1);
    setStep(next);
  };

  const submitEmail = async () => {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("Escribe un correo válido.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/miembros/auth/email-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (res.ok) {
        const data = (await res.json()) as { status?: string };
        if (data.status === "login" || data.status === "google") {
          setLoading(false);
          if (onSwitchToLogin) {
            onSwitchToLogin(value);
          } else if (data.status === "google") {
            setError(
              "Esta cuenta entra con Google — inicia sesión desde /acceso."
            );
          } else {
            setError(
              "Este correo ya tiene cuenta. Entra desde la página de acceso."
            );
          }
          return;
        }
      }
    } catch {
      // Sin señal del servidor seguimos igual: el registro final valida.
    }
    setLoading(false);
    goTo(1);
  };

  const submitName = () => {
    if (!firstName.trim()) {
      setError("¿Cómo te llamas?");
      return;
    }
    goTo(2);
  };

  const handlePhoneChange = (raw: string) => {
    setPhone(sanitizeLocalPhoneInput(raw, phoneCountry as CountryCode));
  };

  const submitPhone = () => {
    const { normalized, hint } = validateLocalPhone(
      phone,
      phoneCountry as CountryCode
    );
    if (!normalized) {
      setError(hint ?? "Por favor ingresa un número válido.");
      return;
    }
    goTo(3);
  };

  const submitAll = async () => {
    if (password.trim().length < PASSWORD_MIN_LENGTH) {
      setError(`Usa al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== passwordConfirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (!consent) {
      setError("Necesitamos tu autorización para tratar tus datos.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/miembros/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          phone,
          phoneCountry,
          password,
          consentData: true,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };

      if (!res.ok) {
        setLoading(false);
        if (data.error === "email_taken") {
          if (onSwitchToLogin) {
            onSwitchToLogin(email.trim().toLowerCase());
            return;
          }
          setError("Este correo ya tiene cuenta. Entra desde /acceso.");
          setStep(0);
          return;
        }
        if (data.error === "phone_taken") {
          setError("Ese número ya está registrado con otra cuenta.");
          setStep(2);
          return;
        }
        if (data.error === "weak_password") {
          setError(data.message ?? "Elige una contraseña más segura.");
          return;
        }
        if (data.error === "invalid_phone") {
          setError("Revisa tu número de WhatsApp.");
          setStep(2);
          return;
        }
        setError("No pudimos crear tu cuenta. Intenta de nuevo.");
        return;
      }

      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      setLoading(false);

      if (result?.error) {
        // Cuenta creada pero el login automático falló: mándala al acceso.
        window.location.href = `/acceso?callbackUrl=${encodeURIComponent(destination)}`;
        return;
      }

      if (onComplete) {
        onComplete();
      } else {
        window.location.href = destination;
      }
    } catch {
      setLoading(false);
      setError("Error de red. Intenta de nuevo.");
    }
  };

  const onStepSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (step === 0) void submitEmail();
    else if (step === 1) submitName();
    else if (step === 2) submitPhone();
    else void submitAll();
  };

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {step > 0 && (
              <button
                type="button"
                aria-label="Volver al paso anterior"
                onClick={() => goTo((step - 1) as StepIndex)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-linen/25 text-white/70 transition-colors hover:border-linen/50 hover:text-white"
              >
                ←
              </button>
            )}
            <span className="font-[font2] uppercase text-[10px] tracking-[0.3em] text-white/50">
              Paso {step + 1} de {STEPS.length} · {STEPS[step]}
            </span>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i <= step ? "bg-terracotta" : "bg-linen/15"
              }`}
            />
          ))}
        </div>
      </div>

      <form onSubmit={onStepSubmit} className="space-y-5">
        <fieldset
          key={step}
          disabled={loading}
          className={`space-y-5 border-0 p-0 ${
            direction >= 0 ? "wiz-step-forward" : "wiz-step-back"
          }`}
        >
        {step === 0 && (
          <>
            <label className="block">
              <span className={labelClass}>¿Cuál es tu correo?</span>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className={inputClass}
              />
            </label>
          </>
        )}

        {step === 1 && (
          <>
            <label className="block">
              <span className={labelClass}>¿Cómo te llamas?</span>
              <input
                required
                autoFocus
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Tu nombre"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Apellido (opcional)</span>
              <input
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Tu apellido"
                className={inputClass}
              />
            </label>
          </>
        )}

        {step === 2 && (
          <>
            <p className="font-[font1] text-sm leading-snug text-white/60">
              Tu WhatsApp vincula tus pagos y te llega la confirmación de cada
              compra.
            </p>
            <CheckoutCountrySelect
              value={phoneCountry}
              onChange={(iso) => setPhoneCountry(iso)}
            />
            <label className="block">
              <span className={labelClass}>WhatsApp / teléfono</span>
              <input
                type="tel"
                required
                autoFocus
                inputMode="tel"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder={getLocalPhonePlaceholder(
                  phoneCountry as CountryCode
                )}
                className={inputClass}
              />
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <label className="block">
              <span className={labelClass}>Crea tu contraseña</span>
              <input
                type="password"
                required
                autoFocus
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Repítela</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1"
              />
              <span className="font-[font1] text-xs leading-relaxed text-white/60">
                Acepto el tratamiento de mis datos según el{" "}
                <a
                  href="/aviso-privacidad"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-linen underline"
                >
                  aviso de privacidad
                </a>
                .
              </span>
            </label>
          </>
        )}
        </fieldset>

        {error && (
          <p className="font-[font1] text-[13px] text-blush" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-linen py-3.5 font-[font2] uppercase text-xs tracking-[0.25em] text-black transition-colors hover:bg-white disabled:opacity-60"
        >
          {loading ? (
            <span className="inline-flex items-center justify-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/25 border-t-black" />
              Un momento…
            </span>
          ) : step === 3 ? (
            "Crear mi cuenta"
          ) : (
            "Continuar"
          )}
        </button>
      </form>

      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .wiz-step-forward {
            animation: wiz-in-forward 0.32s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .wiz-step-back {
            animation: wiz-in-back 0.32s cubic-bezier(0.16, 1, 0.3, 1);
          }
        }
        @keyframes wiz-in-forward {
          from { opacity: 0; transform: translateX(18px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes wiz-in-back {
          from { opacity: 0; transform: translateX(-18px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};

export default OnboardingWizard;
