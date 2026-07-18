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
  googleEnabled: boolean;
  /** Same-site path to land on (or continue to) once the account exists. */
  callbackUrl?: string;
  /** Inline embeds (checkout overlay): called after signup + sign-in instead
   *  of navigating away. */
  onComplete?: () => void;
  /** The email already has a working account — flip the host UI to login. */
  onSwitchToLogin?: (email: string) => void;
};

const GoogleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="#EA4335"
      d="M12 5.04c1.72 0 3.26.59 4.47 1.75l3.32-3.32C17.78 1.6 15.1.5 12 .5 7.42.5 3.44 3.13 1.5 6.96l3.87 3C6.29 7.14 8.9 5.04 12 5.04Z"
    />
    <path
      fill="#4285F4"
      d="M23.5 12.27c0-.94-.08-1.63-.26-2.35H12v4.45h6.56c-.13 1.1-.85 2.76-2.44 3.87l3.78 2.93c2.26-2.09 3.6-5.17 3.6-8.9Z"
    />
    <path
      fill="#FBBC05"
      d="M5.38 14.04a7.2 7.2 0 0 1-.38-2.29c0-.8.14-1.57.37-2.29l-3.87-3A11.96 11.96 0 0 0 .25 11.75c0 1.93.46 3.75 1.25 5.29l3.88-3Z"
    />
    <path
      fill="#34A853"
      d="M12 23c3.1 0 5.7-1.02 7.6-2.78l-3.78-2.93c-1.01.7-2.36 1.2-3.82 1.2-3.1 0-5.71-2.1-6.63-4.95l-3.87 3C3.44 20.37 7.42 23 12 23Z"
    />
  </svg>
);

/**
 * Multi-step signup: one question at a time (email → nombre → WhatsApp →
 * contraseña), branded like the rest of the auth surfaces. Creates the
 * account directly (POST /api/miembros/auth/signup) and signs in — no
 * emailed link in this path.
 */
const OnboardingWizard = ({
  googleEnabled,
  callbackUrl,
  onComplete,
  onSwitchToLogin,
}: OnboardingWizardProps) => {
  const [step, setStep] = useState<StepIndex>(0);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("CO");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [consent, setConsent] = useState(false);
  const [googleHint, setGoogleHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const destination = callbackUrl ?? "/miembros";

  const goTo = (next: StepIndex) => {
    setError(null);
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
    setGoogleHint(false);
    try {
      const res = await fetch("/api/miembros/auth/email-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (res.ok) {
        const data = (await res.json()) as { status?: string };
        if (data.status === "login") {
          setLoading(false);
          if (onSwitchToLogin) {
            onSwitchToLogin(value);
          } else {
            setError(
              "Este correo ya tiene cuenta. Entra desde la página de acceso."
            );
          }
          return;
        }
        if (data.status === "google") {
          setLoading(false);
          setGoogleHint(true);
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
        {step === 0 && (
          <>
            {googleEnabled ? (
              <>
                <button
                  type="button"
                  onClick={() => signIn("google", { redirectTo: destination })}
                  className={`flex w-full items-center justify-center gap-3 rounded-xl border py-3.5 font-[font1] text-sm text-white/90 transition-colors hover:border-linen/40 hover:bg-linen/[0.06] ${
                    googleHint
                      ? "border-terracotta/70 bg-terracotta/10"
                      : "border-linen/20 bg-black/20"
                  }`}
                >
                  <GoogleIcon />
                  Continuar con Google
                </button>
                {googleHint && (
                  <p className="font-[font1] text-[13px] text-linen/90">
                    Esta cuenta entra con Google — usa el botón de arriba.
                  </p>
                )}
                <div className="flex items-center gap-3" aria-hidden>
                  <span className="h-px flex-1 bg-linen/15" />
                  <span className="font-[font1] text-[11px] text-white/35">o</span>
                  <span className="h-px flex-1 bg-linen/15" />
                </div>
              </>
            ) : null}

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
          {loading
            ? "Un momento…"
            : step === 3
              ? "Crear mi cuenta"
              : "Continuar"}
        </button>
      </form>
    </div>
  );
};

export default OnboardingWizard;
