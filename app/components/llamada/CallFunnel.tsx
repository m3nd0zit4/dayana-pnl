"use client";

import { Suspense, use, useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { type CountryCode } from "libphonenumber-js";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { trackMetaEvent } from "@/app/components/analytics/MetaPixel";
import CheckoutCountrySelect from "@/app/components/payments/CheckoutCountrySelect";
import { useCookieConsent } from "@/app/context/CookieConsentContext";
import { pushDataLayerEvent } from "@/lib/analytics/dataLayer";
import { buildWhatsAppUrl } from "@/lib/contact";
import { attributionFromUrl, GOALS, helpMessage, INVESTS, TOPICS, URGENCIES, type GoalId, type InvestId, type TopicId, type UrgencyId } from "@/lib/crm/call-funnel/rules";
import { getLocalPhonePlaceholder, sanitizeLocalPhoneInput, validateLocalPhone } from "@/lib/phone";

import { captureAttribution, storedAttribution } from "./attribution";
import { SlotPicker, SlotPickerSeedProvider, SlotPickerSkeleton, type SlotPickerProps, type SlotPickerSeed } from "./SlotPicker";
import { funnelCard, primaryBtn, textLink } from "./styles";
import { readStoredToken, saveStoredToken } from "./token-store";

/**
 * El formulario de la llamada gratis (`/llamada`), en tres pasos:
 *
 * 1. «Tus datos»: nombre y WhatsApp. Se guarda al instante (`POST /api/llamada`):
 *    quien no termine ya es un contacto al que Dayana puede escribirle.
 * 2. «Cuéntanos un poco»: qué quiere trabajar y para cuándo. Si guardar falla,
 *    la persona sigue igual al paso 3: lo que importa es que elija su hora.
 * 3. «Elige tu hora»: el selector de horas. Agendada, va a su página
 *    (`/llamada/<token>`).
 *
 * El formulario ES la llamada a la acción: el paso 1 está a la vista al llegar,
 * sin un botón que lo destape. Todo lo escrito vive aquí arriba, así que ir
 * atrás y volver no borra nada.
 */

export type CallFunnelProps = {
  /** El país de quien visita (ISO), para el prefijo del WhatsApp. */
  defaultCountry: string | null;
  /**
   * Las horas que la página pidió en el servidor, sin esperarlas: llegan por
   * streaming y el paso 3 abre con ellas en vez de con un hueco.
   */
  hours: Promise<SlotPickerSeed | null>;
  /** wa.me con el mensaje ya escrito, para cuando el formulario no puede guardar. */
  whatsappUrl: string;
};

type Step = 1 | 2 | 3;

type DetailErrors = { firstName?: string; phone?: string; consent?: string };
type AnswerErrors = { topic?: string; goal?: string; urgency?: string; invest?: string; commit?: string; email?: string };

const STEP_TITLE: Record<Step, string> = { 1: "Tus datos", 2: "Cuéntanos un poco", 3: "Elige tu hora" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Lo mismo que rechaza el servidor en el nombre (`parseStartBody`). */
const NOT_A_NAME = /https?:|www\.|[<>@]/i;

const labelCls = "block font-[font2] text-sm text-foreground";
const fieldInput =
  "mt-1.5 block w-full rounded-xl border border-input bg-paper/70 dark:bg-background px-4 font-[font1] text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 dark:border-foreground/20 dark:placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25 aria-invalid:border-destructive aria-invalid:focus:ring-destructive/25";
const backBtn =
  "inline-flex min-h-11 items-center gap-2 self-start rounded-full px-2 font-[font2] text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50";
const checkbox = "mt-0.5 size-5 shrink-0 cursor-pointer accent-primary";

const FieldError = ({ id, text }: { id: string; text?: string }) =>
  text ? (
    <p id={id} role="alert" className="mt-1.5 font-[font1] text-sm leading-snug text-destructive">
      {text}
    </p>
  ) : null;

/** Una pregunta de elegir una opción, como lista con circulitos. */
const Choice = <T extends string>(props: {
  id: string;
  name: string;
  legend: string;
  hint?: string;
  options: readonly { id: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  error?: string;
}) => (
  <fieldset className="min-w-0" aria-describedby={props.error ? `${props.id}-${props.name}-error` : undefined}>
    <legend className={labelCls}>{props.legend}</legend>
    {props.hint ? <p className="mt-1 font-[font1] text-xs leading-snug text-muted-foreground">{props.hint}</p> : null}
    {/* Una lista sencilla con su circulito (dueño, 12-nov: «en lugar de botones,
        como una lista, más sencilla»). Cada fila mide 44 px para el dedo. */}
    <div className="mt-1.5 divide-y divide-border">
      {props.options.map((o, i) => (
        <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
          <input
            id={i === 0 ? `${props.id}-${props.name}` : undefined}
            type="radio"
            name={`${props.id}-${props.name}`}
            value={o.id}
            checked={props.value === o.id}
            onChange={() => props.onChange(o.id)}
            className="size-[18px] shrink-0 cursor-pointer accent-primary"
          />
          <span className="font-[font1] text-[0.95rem] leading-snug text-foreground">{o.label}</span>
        </label>
      ))}
    </div>
    <FieldError id={`${props.id}-${props.name}-error`} text={props.error} />
  </fieldset>
);

const browserZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

/** El selector con las horas que trajo la página. Solo se monta en el paso 3, cuando ya llegaron (o casi). */
const SeededSlotPicker = ({ hours, ...props }: SlotPickerProps & { hours: Promise<SlotPickerSeed | null> }) => {
  const seed = use(hours);
  return (
    <SlotPickerSeedProvider value={seed}>
      <SlotPicker {...props} />
    </SlotPickerSeedProvider>
  );
};

const CallFunnel = ({ defaultCountry, hours, whatsappUrl }: CallFunnelProps) => {
  const id = useId();
  // La medición va con permiso: el Pixel solo existe si se aceptó la publicidad
  // (`trackMetaEvent` no hace nada sin él) y el dataLayer se llena solo con
  // alguno de los dos permisos, igual que en la página de la persona.
  const { analyticsEnabled, marketingEnabled } = useCookieConsent();
  const measured = analyticsEnabled || marketingEnabled;
  const [step, setStep] = useState<Step>(1);

  // Paso 1
  const [firstName, setFirstName] = useState("");
  const [country, setCountry] = useState((defaultCountry || "CO").toUpperCase());
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentNews, setConsentNews] = useState(false);
  /** Trampa para bots (el campo oculto). */
  const [hp, setHp] = useState("");
  const [detailErrors, setDetailErrors] = useState<DetailErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** El enlace secreto de este envío, y con qué datos se pidió (volver atrás sin cambiar nada no crea otro). */
  const [token, setToken] = useState<string | null>(null);
  const [savedDetails, setSavedDetails] = useState<string | null>(null);

  // Paso 2
  const [topic, setTopic] = useState<TopicId | null>(null);
  const [urgency, setUrgency] = useState<UrgencyId | null>(null);
  const [goal, setGoal] = useState<GoalId | null>(null);
  const [invest, setInvest] = useState<InvestId | null>(null);
  const [occupation, setOccupation] = useState("");
  const [social, setSocial] = useState("");
  /** «Si agendo, estaré a la hora que elija»: el compromiso de asistir (como en las páginas que más convierten). */
  const [commit, setCommit] = useState(false);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [answerErrors, setAnswerErrors] = useState<AnswerErrors>({});
  const [savedAnswers, setSavedAnswers] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  /** El candado contra el doble envío: el estado tarda un render en llegar al botón. */
  const busy = useRef(false);
  /** Cada evento de medición se manda una sola vez por visita, aunque la persona vuelva atrás y reenvíe. */
  const fired = useRef({ lead: false, answers: false, booked: false });

  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef<Step>(step);

  // Al aterrizar se guarda de dónde vino (primer toque).
  useEffect(() => {
    captureAttribution();
  }, []);

  // Al cambiar de paso el foco va al título del paso nuevo (lo anuncia el lector
  // de pantalla) y la tarjeta vuelve arriba: el paso 2 es más largo que el 1.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus({ preventScroll: true });
    cardRef.current?.scrollIntoView({ block: "start" });
  }, [step]);

  const focusField = (suffix: string) => document.getElementById(`${id}-${suffix}`)?.focus();

  const clearDetailError = (key: keyof DetailErrors) => setDetailErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  const clearAnswerError = (key: keyof AnswerErrors) => setAnswerErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  const showDetailErrors = (errors: DetailErrors) => {
    setDetailErrors(errors);
    focusField(errors.firstName ? "nombre" : errors.phone ? "whatsapp" : "permiso");
  };

  // ── Paso 1: datos ─────────────────────────────────────────────────────────

  const submitDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    setFormError(null);

    const name = firstName.trim();
    const local = sanitizeLocalPhoneInput(phone, country as CountryCode);
    const errors: DetailErrors = {};
    if (!name) errors.firstName = "Escribe tu nombre.";
    else if (name.length < 2) errors.firstName = "Tu nombre debe tener al menos 2 letras.";
    else if (NOT_A_NAME.test(name)) errors.firstName = "Escribe solo tu nombre, sin enlaces ni símbolos.";
    if (!local) errors.phone = "Escribe tu número de WhatsApp: ahí te llama Dayana.";
    else {
      const { normalized, hint } = validateLocalPhone(local, country as CountryCode);
      if (!normalized) errors.phone = hint ?? "Revisa el número.";
    }
    if (!consent) errors.consent = "Marca esta casilla para que Dayana pueda contactarte.";
    if (errors.firstName || errors.phone || errors.consent) {
      showDetailErrors(errors);
      return;
    }
    setDetailErrors({});

    // Volvió atrás y no cambió nada: su enlace sigue siendo el mismo.
    const details = JSON.stringify([name, country, local, consentNews]);
    if (token && details === savedDetails) {
      setStep(2);
      return;
    }

    busy.current = true;
    setSending(true);
    try {
      const attribution =
        storedAttribution() ?? attributionFromUrl(window.location.search, document.referrer || null, window.location.pathname);
      const res = await fetch("/api/llamada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: name,
          lastName: null,
          phone: local,
          phoneCountry: country,
          consentData: true,
          consentMarketing: consentNews,
          timezone: browserZone(),
          attribution,
          hp,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: unknown; token?: unknown; error?: unknown } | null;

      if (res.ok && data?.ok === true && typeof data.token === "string" && data.token) {
        setToken(data.token);
        setSavedDetails(details);
        // Un enlace nuevo no tiene respuestas guardadas: el paso 2 las vuelve a mandar.
        setSavedAnswers(null);
        // El enlace guardado solo cambia cuando el nuevo ya tiene su llamada
        // (más abajo, al agendar): quien vuelve a llenar el formulario con una
        // llamada ya agendada no pierde el enlace para cambiarla o cancelarla.
        if (!readStoredToken()) saveStoredToken(data.token);
        if (!fired.current.lead) {
          fired.current.lead = true;
          trackMetaEvent("Lead", { content_name: "llamada_gratis" });
          if (measured) pushDataLayerEvent("call_funnel_lead");
        }
        setStep(2);
        return;
      }

      switch (data?.error) {
        case "name_required":
          showDetailErrors({ firstName: "Escribe tu nombre: al menos 2 letras, sin enlaces ni símbolos." });
          break;
        case "phone_required":
          showDetailErrors({ phone: "Escribe tu número de WhatsApp completo." });
          break;
        case "invalid_phone":
          showDetailErrors({ phone: "Ese número no es válido para el país elegido. Revisa el país y el número." });
          break;
        case "consent_required":
          showDetailErrors({ consent: "Marca esta casilla para que Dayana pueda contactarte." });
          break;
        case "rate_limited":
          setFormError("Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.");
          break;
        case "invalid":
          setFormError("No pudimos leer tus datos. Revisa el nombre y el número e inténtalo de nuevo.");
          break;
        default:
          setFormError(
            res.status === 429
              ? "Demasiados intentos seguidos. Espera un minuto y vuelve a intentar."
              : "Algo falló de nuestro lado y no se guardaron tus datos. Inténtalo de nuevo en un momento."
          );
      }
    } catch {
      setFormError("No pudimos conectar. Revisa tu internet e inténtalo de nuevo.");
    } finally {
      busy.current = false;
      setSending(false);
    }
  };

  // ── Paso 2: preguntas ─────────────────────────────────────────────────────

  const submitAnswers = async (e: FormEvent) => {
    e.preventDefault();
    if (busy.current) return;

    const mail = email.trim();
    const errors: AnswerErrors = {};
    if (!topic) errors.topic = "Elige la opción que más se parezca a lo tuyo.";
    if (!goal) errors.goal = "Elige a dónde te gustaría llegar.";
    if (!urgency) errors.urgency = "Elige una opción.";
    if (!invest) errors.invest = "Elige una opción. Ninguna te deja sin llamada.";
    if (!commit) errors.commit = "Marca esta casilla para seguir: Dayana reserva ese espacio solo para ti.";
    if (mail && !EMAIL_RE.test(mail)) errors.email = "Revisa tu correo, o déjalo vacío.";
    const first = (["topic", "goal", "urgency", "invest", "commit", "email"] as const).find((k) => errors[k]);
    if (first) {
      setAnswerErrors(errors);
      focusField({ topic: "tema", goal: "meta", urgency: "urgencia", invest: "invertir", commit: "compromiso", email: "correo" }[first]);
      return;
    }
    setAnswerErrors({});
    if (!token || !topic || !urgency) {
      setStep(token ? 3 : 1);
      return;
    }

    const answers = JSON.stringify([token, topic, goal, urgency, invest, occupation.trim(), social.trim(), note.trim(), mail]);
    if (answers === savedAnswers) {
      setStep(3);
      return;
    }

    busy.current = true;
    setSending(true);
    try {
      const res = await fetch(`/api/llamada/${encodeURIComponent(token)}/respuestas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          goal,
          urgency,
          invest,
          occupation: occupation.trim() || null,
          social: social.trim() || null,
          committed: commit,
          note: note.trim() || null,
          email: mail || null,
        }),
      });
      if (res.ok) {
        setSavedAnswers(answers);
        if (!fired.current.answers) {
          fired.current.answers = true;
          if (measured) pushDataLayerEvent("call_funnel_answers");
        }
      }
    } catch {
      /* sin conexión: abajo sigue igual al paso 3 */
    } finally {
      busy.current = false;
      setSending(false);
      // Guardadas o no, la persona sigue: lo que importa es que elija su hora.
      // (Si no se guardaron, volver a este paso y continuar las reenvía.)
      setStep(3);
    }
  };

  // ── Paso 3: hora ──────────────────────────────────────────────────────────

  const handleBooked = useCallback(
    () => {
      if (!fired.current.booked) {
        fired.current.booked = true;
        trackMetaEvent("Schedule", { content_name: "llamada_gratis" });
        if (measured) pushDataLayerEvent("call_funnel_booked", { place: "llamada" });
      }
      // Carga completa y no navegación de cliente: en su página personal el
      // Pixel y GTM no se cargan (su dirección es un secreto), y con una
      // navegación de cliente los ya cargados aquí seguirían vivos allá.
      if (token) saveStoredToken(token);
      if (token) window.location.assign(`/llamada/${encodeURIComponent(token)}`);
    },
    [token, measured]
  );

  const helpUrl = buildWhatsAppUrl(firstName.trim() ? helpMessage(firstName.trim()) : "Hola, quiero agendar mi llamada gratis con Dayana.");

  return (
    <section ref={cardRef} id="agendar" aria-label="Agenda tu sesión 1 a 1 gratis" className={funnelCard} data-testid="llamada-formulario">
      <div className="flex items-center justify-between gap-4">
        {/* El título de abajo ya lo dice para el lector de pantalla. */}
        <p aria-hidden="true" className="font-[font2] text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Paso {step} de 3
        </p>
        <div aria-hidden="true" className="flex gap-1.5">
          {([1, 2, 3] as const).map((n) => (
            <span key={n} className={`h-1 w-8 rounded-full transition-colors ${n <= step ? "bg-terracotta" : "bg-foreground/10"}`} />
          ))}
        </div>
      </div>

      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-3 rounded-sm font-[font2] text-2xl leading-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="sr-only">Paso {step} de 3: </span>
        {STEP_TITLE[step]}
      </h2>

      {step === 1 ? (
        <form onSubmit={submitDetails} noValidate className="mt-5 flex flex-col gap-4" data-testid="llamada-paso-1">
          {/* Trampa para bots: fuera de la pantalla, sin foco y oculta a los lectores
              de pantalla. Una persona nunca la rellena; si llega con algo, el
              servidor contesta como a todos sin guardar nada. */}
          <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
            <label>
              No completes este campo
              <input type="text" name="sitio_web_hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
            </label>
          </div>

          <div>
            <label htmlFor={`${id}-nombre`} className={labelCls}>
              Tu nombre
            </label>
            <input
              id={`${id}-nombre`}
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                clearDetailError("firstName");
              }}
              autoComplete="given-name"
              autoCapitalize="words"
              enterKeyHint="next"
              maxLength={60}
              placeholder="Cómo te llamas"
              aria-invalid={Boolean(detailErrors.firstName)}
              aria-describedby={detailErrors.firstName ? `${id}-nombre-error` : undefined}
              className={`${fieldInput} h-13`}
            />
            <FieldError id={`${id}-nombre-error`} text={detailErrors.firstName} />
          </div>

          <div role="group" aria-label="País de tu WhatsApp">
            <CheckoutCountrySelect
              themed
              label="País de tu WhatsApp"
              value={country}
              disabled={sending}
              onChange={(iso) => {
                setCountry(iso.toUpperCase());
                clearDetailError("phone");
              }}
            />
          </div>

          <div>
            <label htmlFor={`${id}-whatsapp`} className={labelCls}>
              Tu WhatsApp
            </label>
            <input
              id={`${id}-whatsapp`}
              value={phone}
              onChange={(e) => {
                setPhone(sanitizeLocalPhoneInput(e.target.value, country as CountryCode));
                clearDetailError("phone");
              }}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              enterKeyHint="done"
              placeholder={getLocalPhonePlaceholder(country as CountryCode)}
              aria-invalid={Boolean(detailErrors.phone)}
              aria-describedby={detailErrors.phone ? `${id}-whatsapp-error` : `${id}-whatsapp-ayuda`}
              className={`${fieldInput} h-13`}
            />
            {detailErrors.phone ? (
              <FieldError id={`${id}-whatsapp-error`} text={detailErrors.phone} />
            ) : (
              <p id={`${id}-whatsapp-ayuda`} className="mt-1.5 font-[font1] text-xs leading-snug text-muted-foreground">
                A este número te llama Dayana.
              </p>
            )}
          </div>

          <div>
            <label className="flex cursor-pointer items-start gap-3 py-1">
              <input
                id={`${id}-permiso`}
                type="checkbox"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  clearDetailError("consent");
                }}
                aria-invalid={Boolean(detailErrors.consent)}
                aria-describedby={detailErrors.consent ? `${id}-permiso-error` : undefined}
                className={checkbox}
              />
              <span className="font-[font1] text-sm leading-snug text-muted-foreground">
                Acepto que Dayana me contacte por WhatsApp y el tratamiento de mis datos según el{" "}
                <a href="/aviso-privacidad" target="_blank" rel="noopener noreferrer" className={textLink}>
                  aviso de privacidad
                </a>
                .
              </span>
            </label>
            <FieldError id={`${id}-permiso-error`} text={detailErrors.consent} />
          </div>

          <label className="flex cursor-pointer items-start gap-3 py-1">
            <input type="checkbox" checked={consentNews} onChange={(e) => setConsentNews(e.target.checked)} className={checkbox} />
            <span className="font-[font1] text-sm leading-snug text-muted-foreground">
              <span className="font-[font2] text-foreground">Opcional.</span> Quiero recibir por WhatsApp y correo información de los talleres y
              eventos grupales de Dayana, gratuitos o de pago. Puedo pedir que no me escriban más cuando quiera.
            </span>
          </label>

          {formError ? (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 font-[font1] text-sm leading-relaxed text-foreground">
              {formError}{" "}
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={textLink}>
                O escríbenos por WhatsApp
              </a>
              .
            </p>
          ) : null}

          <button type="submit" disabled={sending} aria-busy={sending} className={primaryBtn}>
            {sending ? "Guardando…" : "Continuar"}
            {sending ? null : <ArrowRight className="size-4 shrink-0" aria-hidden="true" />}
          </button>
          <p className="-mt-1 text-center font-[font1] text-xs leading-snug text-muted-foreground">Siguen unas preguntas rápidas y eliges tu hora.</p>
        </form>
      ) : null}

      {step === 2 ? (
        <form onSubmit={submitAnswers} noValidate className="mt-2 flex flex-col gap-6" data-testid="llamada-paso-2">
          <p className="font-[font1] text-sm leading-relaxed text-muted-foreground">Así Dayana llega a la llamada sabiendo cómo ayudarte. Todo se responde tocando.</p>

          <Choice
            id={id}
            name="tema"
            legend="¿Cómo te sientes hoy?"
            options={TOPICS}
            value={topic}
            onChange={(v) => {
              setTopic(v);
              clearAnswerError("topic");
            }}
            error={answerErrors.topic}
          />

          <Choice
            id={id}
            name="meta"
            legend="¿A dónde te gustaría llegar en los próximos meses?"
            options={GOALS}
            value={goal}
            onChange={(v) => {
              setGoal(v);
              clearAnswerError("goal");
            }}
            error={answerErrors.goal}
          />

          <Choice
            id={id}
            name="urgencia"
            legend="¿Para cuándo quieres empezar?"
            options={URGENCIES}
            value={urgency}
            onChange={(v) => {
              setUrgency(v);
              clearAnswerError("urgency");
            }}
            error={answerErrors.urgency}
          />

          <Choice
            id={id}
            name="invertir"
            legend="Si la llamada te convence, ¿estás en disposición de invertir en tu proceso?"
            hint="Es para que Dayana sepa qué proponerte. Ninguna respuesta te deja sin llamada."
            options={INVESTS}
            value={invest}
            onChange={(v) => {
              setInvest(v);
              clearAnswerError("invest");
            }}
            error={answerErrors.invest}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-oficio`} className={labelCls}>
                ¿A qué te dedicas hoy? <span className="font-[font1] text-muted-foreground">(opcional)</span>
              </label>
              <input
                id={`${id}-oficio`}
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                maxLength={120}
                autoComplete="organization-title"
                placeholder="Ej.: trabajo en una empresa, estudio…"
                className={`${fieldInput} h-13`}
              />
            </div>
            <div>
              <label htmlFor={`${id}-redes`} className={labelCls}>
                Tu Instagram o TikTok <span className="font-[font1] text-muted-foreground">(opcional)</span>
              </label>
              <input
                id={`${id}-redes`}
                value={social}
                onChange={(e) => setSocial(e.target.value)}
                maxLength={120}
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="@tuusuario"
                className={`${fieldInput} h-13`}
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${id}-nota`} className={labelCls}>
              ¿Algo que quieras contarle a Dayana? <span className="font-[font1] text-muted-foreground">(opcional)</span>
            </label>
            <textarea
              id={`${id}-nota`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              aria-describedby={`${id}-nota-ayuda`}
              className={`${fieldInput} resize-y py-3 leading-relaxed`}
            />
            <p id={`${id}-nota-ayuda`} className="mt-1.5 font-[font1] text-xs leading-snug text-muted-foreground">
              Es opcional. Lo leen Dayana y su equipo, para preparar tu llamada.
            </p>
          </div>

          <div>
            <label htmlFor={`${id}-correo`} className={labelCls}>
              Tu correo <span className="font-[font1] text-muted-foreground">(opcional)</span>
            </label>
            <input
              id={`${id}-correo`}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearAnswerError("email");
              }}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              maxLength={160}
              placeholder="tu@correo.com"
              aria-invalid={Boolean(answerErrors.email)}
              aria-describedby={answerErrors.email ? `${id}-correo-error` : undefined}
              className={`${fieldInput} h-13`}
            />
            <FieldError id={`${id}-correo-error`} text={answerErrors.email} />
          </div>

          <div>
            <label className="flex cursor-pointer items-start gap-3 py-1">
              <input
                id={`${id}-compromiso`}
                type="checkbox"
                checked={commit}
                onChange={(e) => {
                  setCommit(e.target.checked);
                  clearAnswerError("commit");
                }}
                aria-invalid={Boolean(answerErrors.commit)}
                aria-describedby={answerErrors.commit ? `${id}-compromiso-error` : undefined}
                className={checkbox}
              />
              <span className="font-[font1] text-sm leading-snug text-foreground">
                Me comprometo a estar disponible a la hora que elija, con mi WhatsApp a mano. Si no puedo, la cambio desde mi página con tiempo.
              </span>
            </label>
            <FieldError id={`${id}-compromiso-error`} text={answerErrors.commit} />
          </div>

          <div className="flex flex-col gap-2">
            <button type="submit" disabled={sending} aria-busy={sending} className={primaryBtn}>
              {sending ? "Guardando…" : "Continuar"}
              {sending ? null : <ArrowRight className="size-4 shrink-0" aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => setStep(1)} disabled={sending} className={backBtn}>
              <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
              Atrás
            </button>
          </div>
        </form>
      ) : null}

      {step === 3 && token ? (
        <div className="mt-2 flex flex-col gap-5" data-testid="llamada-paso-3">
          <p className="font-[font1] text-sm leading-relaxed text-muted-foreground">Dayana te llama por WhatsApp a la hora que elijas.</p>
          <Suspense fallback={<SlotPickerSkeleton />}>
            <SeededSlotPicker hours={hours} token={token} submitLabel="Agendar mi llamada" onBooked={handleBooked} helpUrl={helpUrl} />
          </Suspense>
          <button type="button" onClick={() => setStep(2)} className={backBtn}>
            <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
            Atrás
          </button>
        </div>
      ) : null}
    </section>
  );
};

export default CallFunnel;
