"use client";

import { useState } from "react";
import { type CountryCode } from "libphonenumber-js";
import CheckoutCountrySelect from "@/app/components/payments/CheckoutCountrySelect";
import {
  validateLocalPhone,
  getLocalPhonePlaceholder,
  sanitizeLocalPhoneInput,
} from "@/lib/phone";
import { WEBINAR_INTEREST_LABEL } from "@/lib/crm/webinar-interest";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "sending" | "sent";
type FieldErrors = {
  firstName?: string;
  email?: string;
  phone?: string;
  consent?: string;
};

export type LeadCaptureFormProps = {
  userCountry?: string | null;
  /** When set, hides the interest selector and sends this value. */
  fixedInterest?: string;
  source?: string;
  sourceDetail?: string;
  submitLabel?: string;
  formId?: string;
  className?: string;
  /** Visual density for webinar landing vs home. */
  variant?: "home" | "webinar";
};

const INTERESTS = [
  "Sesión privada 1:1",
  "Clases",
  "Taller virtual",
  "Aún no lo sé",
] as const;

const LeadCaptureForm = ({
  userCountry,
  fixedInterest,
  source = "web_lead_form",
  sourceDetail,
  submitLabel = "Quiero que me contacte",
  formId,
  className = "",
  variant = "home",
}: LeadCaptureFormProps) => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState((userCountry || "CO").toUpperCase());
  const [phone, setPhone] = useState("");
  const [interest, setInterest] = useState<string>(
    fixedInterest ?? INTERESTS[0]
  );
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const isWebinar = variant === "webinar";

  const clearErr = (k: keyof FieldErrors) =>
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    setServerError(null);

    const next: FieldErrors = {};
    if (!firstName.trim()) next.firstName = "¿Cómo te llamas?";
    if (!email.trim()) next.email = "Déjame tu correo para crear tu acceso.";
    else if (!EMAIL_RE.test(email.trim())) next.email = "Revisa tu correo.";
    const { normalized, hint } = validateLocalPhone(
      phone,
      country as CountryCode
    );
    if (!phone.trim()) next.phone = "Déjame un teléfono para contactarte.";
    else if (!normalized) next.phone = hint ?? "Revisa el número.";
    if (!consent) next.consent = "Necesito tu permiso para contactarte.";

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    setStatus("sending");

    const interestValue = fixedInterest ?? interest;

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          email: email.trim(),
          phone: normalized!.phoneE164,
          phoneCountry: country,
          source,
          sourceDetail: sourceDetail ?? interestValue,
          interest: interestValue,
          notify: true,
          consentData: true,
          ...(fixedInterest === WEBINAR_INTEREST_LABEL
            ? { tag: "webinar-gratuito" }
            : {}),
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        if (data.error === "invalid_phone") {
          setErrors({ phone: data.message ?? "Número de teléfono inválido." });
        } else if (data.error === "rate_limited") {
          setServerError(
            "Demasiados intentos. Espera un momento e inténtalo de nuevo."
          );
        } else {
          setServerError("Algo falló al enviar. Por favor inténtalo de nuevo.");
        }
        setStatus("idle");
        return;
      }
      setStatus("sent");
    } catch {
      setServerError("Sin conexión. Revisa tu internet e inténtalo de nuevo.");
      setStatus("idle");
    }
  };

  const fieldInput = isWebinar
    ? "mt-1.5 w-full rounded-xl border border-black/10 bg-white/70 px-3.5 py-3 font-[font1] text-base text-black placeholder:text-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-sm transition-colors focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20"
    : "mt-2 w-full border-0 border-b bg-transparent pb-2.5 font-[font1] text-lg text-black placeholder:text-black/30 transition-colors focus:outline-none";

  const labelCls = isWebinar
    ? "font-[font2] text-[10px] uppercase tracking-[0.22em] text-black/50"
    : "font-[font2] text-[10px] uppercase tracking-[0.3em] text-black/45";

  const errBorder = (err?: string) => {
    if (isWebinar) {
      return err
        ? "border-[#b4543a]/70 focus:border-[#b4543a] focus:ring-[#b4543a]/20"
        : "";
    }
    return err
      ? "border-[#b4543a]/80 focus:border-[#b4543a]"
      : "border-black/15 focus:border-terracotta";
  };

  if (status === "sent") {
    return (
      <div
        id={formId}
        className={`scroll-mt-24 ${className}`}
        role="status"
        aria-live="polite"
      >
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-terracotta/60 text-terracotta">
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h3 className="mt-6 font-[font2] text-2xl uppercase leading-[0.95] lg:text-3xl">
          ¡Gracias, {firstName.trim() || "ya casi"}!
        </h3>
        <p className="mt-4 max-w-md font-[font1] text-base leading-snug text-black/70 lg:text-lg">
          {fixedInterest === WEBINAR_INTEREST_LABEL
            ? "Tu lugar quedó reservado. Te escribimos pronto con los detalles del webinar y el enlace de acceso."
            : "Recibí tus datos. Te contacto muy pronto — y te enviamos un correo para crear tu acceso a tu cuenta."}
        </p>
      </div>
    );
  }

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      noValidate
      className={`flex scroll-mt-24 flex-col gap-5 ${className}`}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Nombre</span>
          <input
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              clearErr("firstName");
            }}
            autoComplete="given-name"
            placeholder="Tu nombre"
            aria-invalid={!!errors.firstName}
            className={`${fieldInput} ${errBorder(errors.firstName)}`}
          />
          {errors.firstName && (
            <p className="mt-1.5 font-[font1] text-xs text-[#b4543a]">
              {errors.firstName}
            </p>
          )}
        </label>
        <label className="block">
          <span className={labelCls}>
            Apellido <span className="text-black/30">(opcional)</span>
          </span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            placeholder="Tu apellido"
            className={`${fieldInput} ${isWebinar ? "" : "border-black/15 focus:border-terracotta"}`}
          />
        </label>
      </div>

      <label className="block">
        <span className={labelCls}>Correo</span>
        <input
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearErr("email");
          }}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="tu@correo.com"
          aria-invalid={!!errors.email}
          className={`${fieldInput} ${errBorder(errors.email)}`}
        />
        {errors.email && (
          <p className="mt-1.5 font-[font1] text-xs text-[#b4543a]">
            {errors.email}
          </p>
        )}
      </label>

      <div>
        <CheckoutCountrySelect
          light
          label="País del número"
          value={country}
          onChange={(iso) => {
            setCountry(iso.toUpperCase());
            clearErr("phone");
          }}
        />
      </div>

      <label className="block">
        <span className={labelCls}>Teléfono</span>
        <input
          value={phone}
          onChange={(e) => {
            setPhone(
              sanitizeLocalPhoneInput(e.target.value, country as CountryCode)
            );
            clearErr("phone");
          }}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={getLocalPhonePlaceholder(country as CountryCode)}
          aria-invalid={!!errors.phone}
          className={`${fieldInput} ${errBorder(errors.phone)}`}
        />
        {errors.phone && (
          <p className="mt-1.5 font-[font1] text-xs text-[#b4543a]">
            {errors.phone}
          </p>
        )}
      </label>

      {!fixedInterest && (
        <label className="block">
          <span className={labelCls}>¿Qué te interesa?</span>
          <select
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            className={`${fieldInput} cursor-pointer border-black/15 focus:border-terracotta [&>option]:bg-white`}
          >
            {INTERESTS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            clearErr("consent");
          }}
          className="mt-1 accent-terracotta"
        />
        <span className="font-[font1] text-xs leading-relaxed text-black/55">
          Acepto que Dayana me contacte y el tratamiento de mis datos según el{" "}
          <a
            href="/aviso-privacidad"
            className="text-terracotta underline underline-offset-2"
          >
            aviso de privacidad
          </a>
          .
          {errors.consent && (
            <span className="mt-1 block text-[#b4543a]">{errors.consent}</span>
          )}
        </span>
      </label>

      {serverError && (
        <p className="font-[font1] text-sm text-[#b4543a]">{serverError}</p>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        className="group mt-1 inline-flex items-center justify-center gap-3 rounded-full bg-terracotta px-9 py-4 font-[font2] text-xs uppercase tracking-[0.28em] text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c] disabled:opacity-60"
      >
        {status === "sending" ? "Enviando…" : submitLabel}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </form>
  );
};

export default LeadCaptureForm;
