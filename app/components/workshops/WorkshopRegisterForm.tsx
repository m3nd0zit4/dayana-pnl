"use client";

import { useEffect, useRef, useState } from "react";
import { type CountryCode } from "libphonenumber-js";
import { MessageCircle } from "lucide-react";
import CheckoutCountrySelect from "@/app/components/payments/CheckoutCountrySelect";
import { getLocalPhonePlaceholder, sanitizeLocalPhoneInput, validateLocalPhone } from "@/lib/phone";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "sending" | "done";
type Outcome = { alreadyEnrolled: boolean; alreadyRegistered: boolean };
type FieldErrors = { firstName?: string; email?: string; phone?: string; consent?: string };

export type WorkshopRegisterFormProps = {
  slug: string;
  workshopTitle: string;
  userCountry?: string | null;
  /** `/pagar/p/<producto>`: «Separar mi cupo ahora». Sin precio, no hay botón. */
  payPath: string | null;
  /** wa.me con el mensaje ya escrito. */
  whatsappHref: string;
  /** De dónde viene («enlaces»). */
  refSource?: string | null;
};

const fieldInput =
  "mt-1.5 w-full rounded-xl border border-black/10 bg-white/70 px-3.5 py-3 font-[font1] text-base text-black placeholder:text-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-sm transition-colors focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/20";
const labelCls = "font-[font2] text-[10px] uppercase tracking-[0.22em] text-black/50";
const errBorder = (err?: string) => (err ? "border-[#b4543a]/70 focus:border-[#b4543a] focus:ring-[#b4543a]/20" : "");
const primaryBtn =
  "inline-flex w-full items-center justify-center gap-3 rounded-full bg-terracotta px-8 py-4 font-[font2] text-xs uppercase tracking-[0.24em] text-white outline-none transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c] focus-visible:ring-2 focus-visible:ring-terracotta/40 disabled:opacity-60";
const secondaryBtn =
  "inline-flex w-full items-center justify-center gap-2.5 rounded-full border border-black/15 bg-white/60 px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.2em] text-black/80 outline-none backdrop-blur-sm transition-colors hover:border-terracotta/50 hover:text-terracotta focus-visible:ring-2 focus-visible:ring-terracotta/40";

/**
 * El formulario del registro de interés en el taller (dueña, 28-oct: «la gente
 * que oprime ahí en taller se registra y se clasifica como interesada»). Igual
 * que el del evento gratuito: nombre, WhatsApp con país, correo opcional, el
 * permiso de datos y, aparte y sin marcar, el de recibir información de
 * talleres y eventos. Al terminar: «Listo, te escribimos por WhatsApp…» con el
 * botón para separar el cupo de una vez y otro para escribirle a Dayana.
 */
const WorkshopRegisterForm = ({ slug, workshopTitle, userCountry, payPath, whatsappHref, refSource = null }: WorkshopRegisterFormProps) => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState((userCountry || "CO").toUpperCase());
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentNews, setConsentNews] = useState(false);
  /** Trampa para bots (el campo oculto de abajo). */
  const [hp, setHp] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  // En el móvil el botón queda abajo y el «Listo» es más corto que el formulario: se lleva a la vista.
  useEffect(() => {
    if (status === "done") doneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [status]);

  const clearErr = (k: keyof FieldErrors) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    setServerError(null);
    const next: FieldErrors = {};
    if (!firstName.trim()) next.firstName = "¿Cómo te llamas?";
    if (email.trim() && !EMAIL_RE.test(email.trim())) next.email = "Revisa tu correo.";
    const { normalized, hint } = validateLocalPhone(phone, country as CountryCode);
    if (!phone.trim()) next.phone = "Déjanos tu WhatsApp para escribirte.";
    else if (!normalized) next.phone = hint ?? "Revisa el número.";
    if (!consent) next.consent = "Necesitamos tu permiso para escribirte.";
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    setStatus("sending");
    try {
      const res = await fetch(`/api/workshops/${encodeURIComponent(slug)}/registro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          email: email.trim() || undefined,
          phone: normalized!.phoneE164,
          phoneCountry: country,
          consentData: true,
          ...(consentNews ? { consentMarketing: true } : {}),
          ...(refSource ? { ref: refSource } : {}),
          ...(hp ? { hp } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        alreadyEnrolled?: boolean;
        alreadyRegistered?: boolean;
      };
      if (!res.ok) {
        if (data.error === "invalid_phone") setErrors({ phone: data.message ?? "Número de teléfono inválido." });
        else if (data.error === "rate_limited") setServerError("Demasiados intentos. Espera un momento e inténtalo de nuevo.");
        else if (data.error === "closed") setServerError("Las inscripciones de este taller ya cerraron. Escríbenos por WhatsApp y te contamos de la próxima.");
        else setServerError("Algo falló al enviar. Por favor inténtalo de nuevo.");
        setStatus("idle");
        return;
      }
      setOutcome({ alreadyEnrolled: Boolean(data.alreadyEnrolled), alreadyRegistered: Boolean(data.alreadyRegistered) });
      setStatus("done");
    } catch {
      setServerError("Sin conexión. Revisa tu internet e inténtalo de nuevo.");
      setStatus("idle");
    }
  };

  if (status === "done" && outcome) {
    const name = firstName.trim().split(/\s+/)[0];
    return (
      <div ref={doneRef} role="status" aria-live="polite" data-testid="taller-registro-listo" className="scroll-mt-24">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-terracotta/60 text-terracotta">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h3 className="mt-5 font-[font2] text-2xl uppercase leading-[0.95] lg:text-3xl">
          {outcome.alreadyEnrolled ? "Ya tienes tu cupo" : name ? `Listo, ${name}` : "Listo"}
        </h3>
        <p className="mt-4 font-[font1] text-base leading-snug text-black/70">
          {outcome.alreadyEnrolled
            ? `Tu pago del taller «${workshopTitle}» ya está registrado: no necesitas registrarte otra vez. Antes del taller te llega el enlace para entrar.`
            : `${outcome.alreadyRegistered ? "Ya tenías tu registro para este taller. " : ""}Te escribimos por WhatsApp para completar tu inscripción: puedes hacer el pago en el enlace de inscripción o agendar primero una llamada gratis con Dayana, donde te explica el taller y su valor.`}
        </p>
        <div className="mt-6 flex flex-col gap-3">
          {outcome.alreadyEnrolled ? (
            <a href={`/taller-virtual/${encodeURIComponent(slug)}`} className={primaryBtn}>
              Ver el taller
            </a>
          ) : payPath ? (
            <>
              <a href={payPath} className={primaryBtn}>
                Separar mi cupo ahora
              </a>
              <p className="-mt-1 text-center font-[font1] text-xs text-black/45">En el enlace ves el valor y pagas en línea.</p>
            </>
          ) : null}
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Escribirle a Dayana
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5" data-testid="taller-registro-form">
      {/* El texto de la dueña para el botón de Enlaces, en neutro. */}
      <h2 className="font-[font2] text-lg uppercase tracking-wide lg:text-xl">Si te interesa, regístrate</h2>
      {/* Trampa para bots: fuera de la pantalla, sin foco y oculta a los lectores
          de pantalla. Una persona nunca la rellena; si llega con algo, el
          servidor contesta «listo» sin guardar ni enviar nada. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>
          No completes este campo
          <input type="text" name="sitio_web_hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
        </label>
      </div>
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
          {errors.firstName && <p className="mt-1.5 font-[font1] text-xs text-[#b4543a]">{errors.firstName}</p>}
        </label>
        <label className="block">
          <span className={labelCls}>
            Apellido <span className="text-black/30">(opcional)</span>
          </span>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" placeholder="Tu apellido" className={fieldInput} />
        </label>
      </div>

      <div>
        <CheckoutCountrySelect
          light
          label="País de tu WhatsApp"
          value={country}
          onChange={(iso) => {
            setCountry(iso.toUpperCase());
            clearErr("phone");
          }}
        />
      </div>

      <label className="block">
        <span className={labelCls}>WhatsApp</span>
        <input
          value={phone}
          onChange={(e) => {
            setPhone(sanitizeLocalPhoneInput(e.target.value, country as CountryCode));
            clearErr("phone");
          }}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={getLocalPhonePlaceholder(country as CountryCode)}
          aria-invalid={!!errors.phone}
          className={`${fieldInput} ${errBorder(errors.phone)}`}
        />
        {errors.phone && <p className="mt-1.5 font-[font1] text-xs text-[#b4543a]">{errors.phone}</p>}
      </label>

      <label className="block">
        <span className={labelCls}>
          Correo <span className="text-black/30">(opcional)</span>
        </span>
        <input
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearErr("email");
          }}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="tu@correo.com"
          aria-invalid={!!errors.email}
          className={`${fieldInput} ${errBorder(errors.email)}`}
        />
        {errors.email && <p className="mt-1.5 font-[font1] text-xs text-[#b4543a]">{errors.email}</p>}
      </label>

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
          <a href="/aviso-privacidad" className="text-terracotta underline underline-offset-2">
            aviso de privacidad
          </a>
          .{errors.consent && <span className="mt-1 block text-[#b4543a]">{errors.consent}</span>}
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={consentNews} onChange={(e) => setConsentNews(e.target.checked)} className="mt-1 accent-terracotta" />
        <span className="font-[font1] text-xs leading-relaxed text-black/55">
          Quiero recibir por WhatsApp y correo información de los talleres y eventos grupales de Dayana, gratuitos o de pago. Puedo pedir que no me
          escriban más cuando quiera.
        </span>
      </label>

      {serverError && <p className="font-[font1] text-sm text-[#b4543a]">{serverError}</p>}

      <button type="submit" disabled={status === "sending"} className={`group mt-1 ${primaryBtn}`}>
        {status === "sending" ? "Enviando…" : "Registrarme"}
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
      <p className="-mt-2 text-center font-[font1] text-xs text-black/45">
        Registrarte es gratis y no te inscribe todavía: con él te escribimos por WhatsApp.
      </p>
    </form>
  );
};

export default WorkshopRegisterForm;
