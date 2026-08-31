"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { type CountryCode } from "libphonenumber-js";

import CheckoutCountrySelect from "@/app/components/payments/CheckoutCountrySelect";
import {
  getLocalPhonePlaceholder,
  sanitizeLocalPhoneInput,
  validateLocalPhone,
} from "@/lib/phone";
import {
  DIAGNOSTIC_QUESTIONS,
  isAnswered,
  type DiagnosticAnswers,
  type DiagnosticQuestion,
} from "@/lib/diagnostico/questions";
import { pushDataLayerEvent } from "@/lib/analytics/dataLayer";
import { trackMetaEvent } from "@/app/components/analytics/MetaPixel";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  userCountry?: string | null;
  /** De dónde llegó, para atribuir el embudo. */
  source?: string;
};

type FieldErrors = {
  firstName?: string;
  email?: string;
  phone?: string;
  consent?: string;
};

const CONTACT_STEP = DIAGNOSTIC_QUESTIONS.length;
const TOTAL_STEPS = DIAGNOSTIC_QUESTIONS.length + 1;

const DiagnosticoWizard = ({ userCountry, source = "terapias" }: Props) => {
  const router = useRouter();

  const [step, setStep] = useState(0);
  /** 1 hacia delante, -1 hacia atrás: decide de qué lado entra la pregunta. */
  const [direction, setDirection] = useState<1 | -1>(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const [answers, setAnswers] = useState<DiagnosticAnswers>({});
  const [token, setToken] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState((userCountry || "CO").toUpperCase());
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  // El token se pide una sola vez. En StrictMode el efecto corre dos veces en
  // desarrollo y sin esta guarda quedarían dos filas por visita, que es
  // precisamente el ruido que hace inútil la métrica de abandono.
  const requestedToken = useRef(false);

  useEffect(() => {
    if (requestedToken.current) return;
    requestedToken.current = true;

    pushDataLayerEvent("diagnostic_start", { source });

    void fetch("/api/diagnostico", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { token?: string } | null) => {
        if (data?.token) setToken(data.token);
      })
      .catch(() => {
        // Sin token el cuestionario sigue funcionando en el cliente y sólo se
        // pierde el autoguardado. Cortar aquí sería cambiar una métrica por
        // una conversión, que es el peor negocio posible.
      });
  }, [source]);

  // Mover el foco al enunciado en cada paso: sin esto un lector de pantalla se
  // queda anclado al botón que acaba de desaparecer.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const persist = useCallback(
    (partial: DiagnosticAnswers) => {
      if (!token) return;
      void fetch(`/api/diagnostico/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: partial }),
      }).catch(() => {
        /* el autoguardado es best-effort */
      });
    },
    [token],
  );

  const question: DiagnosticQuestion | undefined = DIAGNOSTIC_QUESTIONS[step];
  const isContactStep = step === CONTACT_STEP;

  const setAnswer = (value: string | string[]) => {
    if (!question) return;
    const partial = { [question.id]: value } as DiagnosticAnswers;
    setAnswers((prev) => ({ ...prev, ...partial }));
    persist(partial);
  };

  /**
   * Cada pregunta entra desde el lado hacia el que se avanza.
   *
   * Sin esto las ocho preguntas se sustituyen sin más y el cuestionario se
   * siente como ocho páginas sueltas en vez de un recorrido: no hay señal de
   * que se esté avanzando, sólo de que la pantalla cambió. La dirección es lo
   * que convierte «otra pregunta» en «vas por la quinta».
   */
  useGSAP(
    () => {
      const el = stageRef.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(el, { clearProps: "all" });
        return;
      }
      gsap.fromTo(
        el,
        { autoAlpha: 0, x: 34 * direction },
        { autoAlpha: 1, x: 0, duration: 0.42, ease: "power3.out" },
      );
    },
    { dependencies: [step] },
  );

  const goNext = () => {
    if (question) {
      pushDataLayerEvent("diagnostic_step", {
        step: step + 1,
        question_id: question.id,
      });
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, CONTACT_STEP));
  };

  const goBack = () => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  };

  const canAdvance =
    !question || !question.required || isAnswered(question, answers);

  const clearErr = (k: keyof FieldErrors) =>
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setServerError(null);

    const next: FieldErrors = {};
    if (!firstName.trim()) next.firstName = "¿Cómo te llamas?";
    if (!email.trim()) next.email = "Necesito tu correo para enviarte esto.";
    else if (!EMAIL_RE.test(email.trim())) next.email = "Revisa tu correo.";
    const { normalized, hint } = validateLocalPhone(
      phone,
      country as CountryCode,
    );
    if (!phone.trim()) next.phone = "Déjame un WhatsApp para acompañarte.";
    else if (!normalized) next.phone = hint ?? "Revisa el número.";
    if (!consent) next.consent = "Necesito tu permiso para escribirte.";

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);

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
          source: "web_lead_form",
          sourceDetail: "Diagnóstico",
          interest: "Diagnóstico",
          notify: true,
          consentData: true,
          consentAdTracking: true,
          diagnosticToken: token ?? undefined,
          // Las respuestas viajan siempre, no sólo cuando falta el token: el
          // autoguardado es best-effort y la fila puede haber quedado vacía.
          // El servidor decide cuál de las dos fuentes usa.
          diagnosticAnswers: answers,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        diagnosticProfile?: string | null;
        diagnosticToken?: string | null;
      };

      if (!res.ok) {
        if (data.error === "invalid_phone") {
          setErrors({ phone: data.message ?? "Número de teléfono inválido." });
        } else if (data.error === "rate_limited") {
          setServerError(
            "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
          );
        } else {
          setServerError("Algo falló al enviar. Inténtalo de nuevo.");
        }
        setSubmitting(false);
        return;
      }

      pushDataLayerEvent("diagnostic_complete", {
        profile: data.diagnosticProfile ?? null,
      });
      trackMetaEvent("Lead", { content_name: "diagnostico" });

      // El del servidor manda: si la fila la creó él, es el único token que
      // apunta a algo. El local sólo se usa como respaldo.
      const resultToken = data.diagnosticToken ?? token;
      if (resultToken) {
        router.push(`/terapias/resultado/${resultToken}`);
        return;
      }

      // Aquí ya no debería llegarse nunca: el servidor crea la fila aunque no
      // haya token. Si aun así ocurre, se dice — antes se hacía `router.push`
      // a esta misma página, que es una navegación suave sin remontaje: el
      // formulario se quedaba en pantalla con el botón deshabilitado en
      // "Preparando tu resultado…" para siempre, porque `setSubmitting(false)`
      // no se llamaba en el camino de éxito. Contestabas todo y no pasaba nada.
      setSubmitting(false);
      setServerError(
        "Guardamos tus datos pero no pudimos preparar tu resultado. Escríbenos por WhatsApp y te lo pasamos.",
      );
    } catch {
      setServerError("Sin conexión. Revisa tu internet e inténtalo de nuevo.");
      setSubmitting(false);
    }
  };

  const progress = Math.round(((step + 1) / TOTAL_STEPS) * 100);

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-2xl flex-col px-5 py-8 sm:px-8 sm:py-12">
      <div aria-hidden className="flex items-center gap-3">
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-terracotta transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="font-[font2] text-[10px] uppercase tracking-[0.24em] text-black/40">
          {step + 1}/{TOTAL_STEPS}
        </span>
      </div>

      <div
        ref={stageRef}
        className="flex flex-1 flex-col justify-center py-10 sm:py-14"
      >
        {question && !isContactStep ? (
          <QuestionStep
            key={question.id}
            question={question}
            value={answers[question.id]}
            onChange={setAnswer}
            onAdvance={goNext}
            headingRef={headingRef}
          />
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="font-[font2] text-3xl uppercase leading-[0.95] outline-none sm:text-4xl"
            >
              Ya está. ¿A dónde te lo envío?
            </h2>
            <p className="mt-4 font-[font1] text-base leading-snug text-black/60">
              Tu resultado queda guardado en un enlace propio para que puedas
              volver a leerlo cuando quieras.
            </p>

            <div className="mt-8 flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field
                  label="Nombre"
                  value={firstName}
                  onChange={(v) => {
                    setFirstName(v);
                    clearErr("firstName");
                  }}
                  autoComplete="given-name"
                  placeholder="Tu nombre"
                  error={errors.firstName}
                />
                <Field
                  label="Apellido (opcional)"
                  value={lastName}
                  onChange={setLastName}
                  autoComplete="family-name"
                  placeholder="Tu apellido"
                />
              </div>

              <Field
                label="Correo"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  clearErr("email");
                }}
                type="email"
                autoComplete="email"
                placeholder="tu@correo.com"
                error={errors.email}
              />

              <CheckoutCountrySelect
                light
                label="País del número"
                value={country}
                onChange={(iso) => {
                  setCountry(iso.toUpperCase());
                  clearErr("phone");
                }}
              />

              <Field
                label="WhatsApp"
                value={phone}
                onChange={(v) => {
                  setPhone(sanitizeLocalPhoneInput(v, country as CountryCode));
                  clearErr("phone");
                }}
                type="tel"
                autoComplete="tel-national"
                placeholder={getLocalPhonePlaceholder(country as CountryCode)}
                error={errors.phone}
              />

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    clearErr("consent");
                  }}
                  className="mt-1 h-4 w-4 shrink-0 accent-terracotta"
                />
                <span className="font-[font1] text-sm leading-snug text-black/60">
                  Acepto que Dayana me contacte y el tratamiento de mis datos
                  según el{" "}
                  <a href="/aviso-privacidad" className="underline">
                    aviso de privacidad
                  </a>
                  .
                </span>
              </label>
              {errors.consent && (
                <p className="font-[font1] text-xs text-terracotta">
                  {errors.consent}
                </p>
              )}
              {serverError && (
                <p role="alert" className="font-[font1] text-sm text-terracotta">
                  {serverError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-8 w-full rounded-full bg-ink px-8 py-4 font-[font2] text-sm uppercase tracking-[0.18em] text-paper transition-opacity disabled:opacity-50"
            >
              {submitting ? "Preparando tu resultado…" : "Ver mi resultado"}
            </button>
          </form>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0}
          className="font-[font2] text-[11px] uppercase tracking-[0.2em] text-black/40 transition-opacity disabled:invisible"
        >
          ← Atrás
        </button>

        {!isContactStep && (
          <button
            type="button"
            onClick={goNext}
            disabled={!canAdvance}
            className="rounded-full bg-ink px-8 py-3.5 font-[font2] text-xs uppercase tracking-[0.18em] text-paper transition-opacity disabled:opacity-30"
          >
            {question?.required ? "Continuar" : "Continuar"}
          </button>
        )}
      </div>
    </div>
  );
};

/** Un paso de pregunta. Se extrae para que la `key` lo remonte y se reinicie. */
function QuestionStep({
  question,
  value,
  onChange,
  onAdvance,
  headingRef,
}: {
  question: DiagnosticQuestion;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  onAdvance: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const selected = new Set(
    value == null ? [] : Array.isArray(value) ? value : [value],
  );

  const toggleMulti = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-[font2] text-3xl uppercase leading-[0.95] outline-none sm:text-4xl"
      >
        {question.prompt}
      </h2>
      {question.help && (
        <p className="mt-4 font-[font1] text-base leading-snug text-black/55">
          {question.help}
        </p>
      )}

      <div className="mt-8">
        {question.type === "single" && (
          <div className="flex flex-col gap-2.5">
            {(question.options ?? []).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  // Avanzar solo en respuesta única: es inequívoco que terminó.
                  // En selección múltiple hay que esperar a "Continuar".
                  window.setTimeout(onAdvance, 180);
                }}
                aria-pressed={selected.has(option.id)}
                className={`w-full rounded-2xl border px-5 py-4 text-left transition-colors ${
                  selected.has(option.id)
                    ? "border-terracotta bg-terracotta/8"
                    : "border-black/12 hover:border-black/30"
                }`}
              >
                <span className="block font-[font1] text-lg leading-tight">
                  {option.label}
                </span>
                {option.hint && (
                  <span className="mt-1 block font-[font1] text-sm text-black/45">
                    {option.hint}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {question.type === "multi" && (
          <div className="flex flex-col gap-2.5">
            {(question.options ?? []).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => toggleMulti(option.id)}
                aria-pressed={selected.has(option.id)}
                className={`flex w-full items-start gap-3.5 rounded-2xl border px-5 py-4 text-left transition-colors ${
                  selected.has(option.id)
                    ? "border-terracotta bg-terracotta/8"
                    : "border-black/12 hover:border-black/30"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    selected.has(option.id)
                      ? "border-terracotta bg-terracotta text-paper"
                      : "border-black/25"
                  }`}
                >
                  {selected.has(option.id) && (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </span>
                <span>
                  <span className="block font-[font1] text-lg leading-tight">
                    {option.label}
                  </span>
                  {option.hint && (
                    <span className="mt-1 block font-[font1] text-sm text-black/45">
                      {option.hint}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {question.type === "scale" && (
          <div>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
              {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onChange(n)}
                  aria-pressed={selected.has(n)}
                  className={`aspect-square rounded-xl border font-[font2] text-lg transition-colors ${
                    selected.has(n)
                      ? "border-terracotta bg-terracotta text-paper"
                      : "border-black/12 hover:border-black/30"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            {question.scaleLabels && (
              <div className="mt-3 flex justify-between font-[font1] text-xs text-black/40">
                <span>{question.scaleLabels.low}</span>
                <span>{question.scaleLabels.high}</span>
              </div>
            )}
          </div>
        )}

        {question.type === "text" && (
          <textarea
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder={question.placeholder}
            className="w-full rounded-2xl border border-black/12 bg-transparent px-5 py-4 font-[font1] text-lg leading-snug placeholder:text-black/25 focus:border-terracotta focus:outline-none"
          />
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-[font2] text-[10px] uppercase tracking-[0.24em] text-black/45">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        inputMode={type === "tel" ? "tel" : type === "email" ? "email" : "text"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        className={`mt-2 w-full border-0 border-b bg-transparent pb-2.5 font-[font1] text-lg placeholder:text-black/25 focus:outline-none ${
          error ? "border-terracotta" : "border-black/15 focus:border-terracotta"
        }`}
      />
      {error && (
        <p className="mt-1.5 font-[font1] text-xs text-terracotta">{error}</p>
      )}
    </label>
  );
}

export default DiagnosticoWizard;
