"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef, useState } from "react";
import { type CountryCode } from "libphonenumber-js";
import SplitReveal from "../ui/SplitReveal";
import CheckoutCountrySelect from "../payments/CheckoutCountrySelect";
import {
  validateLocalPhone,
  getLocalPhonePlaceholder,
  sanitizeLocalPhoneInput,
} from "../../../lib/phone";

gsap.registerPlugin(ScrollTrigger);

const INTERESTS = [
  "Sesión privada 1:1",
  "Curso / formación",
  "Taller virtual",
  "Aún no lo sé",
] as const;

const STEPS = [
  { n: "01", t: "Escribes" },
  { n: "02", t: "Te respondo yo misma" },
  { n: "03", t: "Empezamos" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "sending" | "sent";
type FieldErrors = { firstName?: string; email?: string; phone?: string; consent?: string };

type Props = { userCountry?: string | null };

const ContactSection = ({ userCountry }: Props) => {
  const rootRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState((userCountry || "CO").toUpperCase());
  const [phone, setPhone] = useState("");
  const [interest, setInterest] = useState<string>(INTERESTS[0]);
  const [consent, setConsent] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      gsap.utils.toArray<HTMLElement>(".ct-reveal").forEach((el) => {
        gsap.from(el, {
          y: 56,
          opacity: 0,
          duration: 1,
          ease: "power4.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });
      gsap.from(".ct-field", {
        y: 24,
        opacity: 0,
        duration: 0.6,
        ease: "power3.out",
        stagger: 0.07,
        scrollTrigger: { trigger: ".ct-form", start: "top 88%" },
      });

      // Heading parallax — same language as the Servicios section.
      if (!reduce) {
        gsap.to(".ct-head", {
          yPercent: -14,
          ease: "none",
          scrollTrigger: {
            trigger: rootRef.current,
            start: "top bottom",
            end: "top top",
            scrub: true,
          },
        });
      }
    },
    { scope: rootRef }
  );

  useGSAP(
    () => {
      if (status === "sent" && panelRef.current) {
        gsap.fromTo(
          panelRef.current,
          { autoAlpha: 0, y: 24, scale: 0.98 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, ease: "power3.out" }
        );
      }
    },
    { dependencies: [status], scope: rootRef }
  );

  const clearErr = (k: keyof FieldErrors) =>
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    setServerError(null);

    const next: FieldErrors = {};
    if (!firstName.trim()) next.firstName = "¿Cómo te llamas?";
    if (email.trim() && !EMAIL_RE.test(email.trim())) next.email = "Revisa tu correo.";
    const { normalized, hint } = validateLocalPhone(phone, country as CountryCode);
    if (!phone.trim()) next.phone = "Déjame un teléfono para contactarte.";
    else if (!normalized) next.phone = hint ?? "Revisa el número.";
    if (!consent) next.consent = "Necesito tu permiso para contactarte.";

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    setStatus("sending");

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          email: email.trim() || undefined,
          phone: normalized!.phoneE164,
          phoneCountry: country,
          source: "web",
          sourceDetail: interest,
          interest,
          notify: true,
          consentData: true,
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
          setServerError("Demasiados intentos. Espera un momento e inténtalo de nuevo.");
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

  const fieldInput =
    "mt-2 w-full border-0 border-b bg-transparent pb-2.5 font-[font1] text-lg text-black placeholder:text-black/30 transition-colors focus:outline-none";
  const labelCls =
    "font-[font2] text-[10px] uppercase tracking-[0.3em] text-black/45";
  const errBorder = (err?: string) =>
    err ? "border-[#b4543a]/80 focus:border-[#b4543a]" : "border-black/15 focus:border-terracotta";

  return (
    <section
      ref={rootRef}
      id="contacto"
      data-nav-color="black"
      className="relative z-10 bg-[#f0ece4] text-black scroll-mt-20 rounded-t-[1.75rem] lg:rounded-t-[3.5rem] shadow-[0_-34px_80px_-24px_rgba(0,0,0,0.5)]"
    >
      <div className="relative px-5 lg:px-12 xl:px-20 py-28 lg:py-36">
        <div className="mx-auto max-w-6xl">
          {/* Headline — full width so it never clips */}
          <SplitReveal
            text={"Hablemos\nsin prisa."}
            className="ct-head mt-5 font-[font2] text-[15vw] sm:text-[12vw] lg:text-[8.6vw] uppercase leading-[0.9]"
          />
          <p className="ct-reveal mt-7 max-w-md font-[font1] text-lg lg:text-xl leading-snug text-black/70">
            Déjame tus datos y te escribo personalmente.
          </p>

          <div className="mt-14 grid grid-cols-1 gap-12 lg:mt-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:items-start">
            {/* What happens next — short, scannable */}
            <ol className="ct-reveal flex flex-col gap-6 border-t border-black/10 pt-8 lg:border-0 lg:pt-2">
              {STEPS.map((s) => (
                <li key={s.n} className="flex items-baseline gap-5">
                  <span className="font-[font2] text-sm tracking-[0.2em] text-terracotta">
                    {s.n}
                  </span>
                  <span className="font-[font2] text-lg uppercase tracking-wide">
                    {s.t}
                  </span>
                </li>
              ))}
            </ol>

            {/* Form / success */}
            <div className="lg:border-l lg:border-black/10 lg:pl-16">
              {status === "sent" ? (
                <div ref={panelRef} className="border-t border-black/10 pt-10 lg:border-t-0 lg:pt-2">
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-terracotta/60 text-terracotta">
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <h3 className="mt-6 font-[font2] text-3xl lg:text-4xl uppercase leading-[0.95]">
                    ¡Gracias, {firstName.trim() || "ya casi"}!
                  </h3>
                  <p className="mt-4 max-w-md font-[font1] text-lg leading-snug text-black/70">
                    Recibí tus datos. Te contacto muy pronto.
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  noValidate
                  className="ct-form flex flex-col gap-6 border-t border-black/10 pt-10 lg:border-t-0 lg:pt-0"
                >
                  <div className="ct-field grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <label className="block">
                      <span className={labelCls}>Nombre</span>
                      <input
                        value={firstName}
                        onChange={(e) => { setFirstName(e.target.value); clearErr("firstName"); }}
                        autoComplete="given-name"
                        placeholder="Tu nombre"
                        aria-invalid={!!errors.firstName}
                        className={`${fieldInput} ${errBorder(errors.firstName)}`}
                      />
                      {errors.firstName && <p className="mt-1.5 font-[font1] text-xs text-[#b4543a]">{errors.firstName}</p>}
                    </label>
                    <label className="block">
                      <span className={labelCls}>Apellido <span className="text-black/30">(opcional)</span></span>
                      <input
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        autoComplete="family-name"
                        placeholder="Tu apellido"
                        className={`${fieldInput} border-black/15 focus:border-terracotta`}
                      />
                    </label>
                  </div>

                  <label className="ct-field block">
                    <span className={labelCls}>Correo <span className="text-black/30">(opcional)</span></span>
                    <input
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); clearErr("email"); }}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="tu@correo.com"
                      aria-invalid={!!errors.email}
                      className={`${fieldInput} ${errBorder(errors.email)}`}
                    />
                    {errors.email && <p className="mt-1.5 font-[font1] text-xs text-[#b4543a]">{errors.email}</p>}
                  </label>

                  <div className="ct-field">
                    <CheckoutCountrySelect
                      light
                      label="País del número"
                      value={country}
                      onChange={(iso) => { setCountry(iso.toUpperCase()); clearErr("phone"); }}
                    />
                  </div>

                  <label className="ct-field block">
                    <span className={labelCls}>Teléfono</span>
                    <input
                      value={phone}
                      onChange={(e) => { setPhone(sanitizeLocalPhoneInput(e.target.value, country as CountryCode)); clearErr("phone"); }}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder={getLocalPhonePlaceholder(country as CountryCode)}
                      aria-invalid={!!errors.phone}
                      className={`${fieldInput} ${errBorder(errors.phone)}`}
                    />
                    {errors.phone && <p className="mt-1.5 font-[font1] text-xs text-[#b4543a]">{errors.phone}</p>}
                  </label>

                  <label className="ct-field block">
                    <span className={labelCls}>¿Qué te interesa?</span>
                    <select
                      value={interest}
                      onChange={(e) => setInterest(e.target.value)}
                      className={`${fieldInput} cursor-pointer border-black/15 focus:border-terracotta [&>option]:bg-white`}
                    >
                      {INTERESTS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </label>

                  <label className="ct-field flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => { setConsent(e.target.checked); clearErr("consent"); }}
                      className="mt-1 accent-terracotta"
                    />
                    <span className="font-[font1] text-xs leading-relaxed text-black/55">
                      Acepto que Dayana me contacte y el tratamiento de mis datos según el{" "}
                      <a href="/aviso-privacidad" className="text-terracotta underline underline-offset-2">aviso de privacidad</a>.
                      {errors.consent && <span className="mt-1 block text-[#b4543a]">{errors.consent}</span>}
                    </span>
                  </label>

                  {serverError && <p className="font-[font1] text-sm text-[#b4543a]">{serverError}</p>}

                  <div className="ct-field mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                    <button
                      type="submit"
                      disabled={status === "sending"}
                      className="group inline-flex items-center justify-center gap-3 rounded-full bg-terracotta px-9 py-4 font-[font2] text-xs uppercase tracking-[0.28em] text-white transition-[background-color,transform] duration-300 hover:bg-[#a8543c] hover:-translate-y-0.5 disabled:opacity-60"
                    >
                      {status === "sending" ? "Enviando…" : "Quiero que me contacte"}
                      <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;
