"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { MessageCircle } from "lucide-react";

import { dayLabel, timeLabel, whenLabel } from "@/lib/crm/call-funnel/rules";

import { optionBox, primaryBtn, secondaryBtn } from "./styles";

/**
 * El selector de horas de la llamada gratis. Lo usan `/llamada` (paso 3) y la
 * página de cada persona (`/llamada/<token>`, para elegir o cambiar su hora).
 *
 * Las horas llegan en UTC y son las mismas para todos; aquí se agrupan por día
 * y se muestran EN LA ZONA DEL NAVEGADOR, y se dice cuál es: quien está en
 * Madrid no tiene que restar seis horas a una cita pensada en Bogotá.
 *
 * Todo lo que puede contestar `POST /api/llamada/<token>/agendar` termina en
 * algo que la persona puede hacer: elegir otra hora, reintentar o escribir por
 * WhatsApp. Nunca en un callejón.
 */

export type SlotPickerProps = {
  token: string;
  /** Button text, e.g. «Agendar mi llamada» or «Cambiar a esta hora». */
  submitLabel: string;
  /** When changing an existing call: its current start, to mark it. */
  currentStartIso?: string | null;
  onBooked: (result: { startIso: string; endIso: string; moved: boolean }) => void;
  /** wa.me link shown when hours can't be shown or booking is closed. */
  helpUrl: string;
};

type Slot = { startIso: string; endIso: string };

/**
 * Horas que ya trae la página desde el servidor, para que el selector abra sin
 * esperar. Es opcional: sin proveedor, el selector las pide él mismo. Con él,
 * las muestra al instante y las vuelve a pedir por detrás (pueden tener minutos).
 */
export type SlotPickerSeed = { slots: Slot[]; minutes: number };

const SeedContext = createContext<SlotPickerSeed | null>(null);

export const SlotPickerSeedProvider = SeedContext.Provider;

// ── La zona del navegador ───────────────────────────────────────────────────

const FALLBACK_ZONE = "America/Bogota";

let browserZone: string | undefined;

const readBrowserZone = (): string => {
  if (browserZone) return browserZone;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Algunos navegadores devuelven una zona que luego no saben formatear.
    new Intl.DateTimeFormat("es-CO", { timeZone: tz });
    browserZone = tz || FALLBACK_ZONE;
  } catch {
    browserZone = FALLBACK_ZONE;
  }
  return browserZone;
};

const subscribeNever = () => () => {};

/** `null` en el servidor y durante la hidratación: allí no se sabe la zona de nadie. */
const useBrowserZone = (): string | null =>
  useSyncExternalStore<string | null>(subscribeNever, readBrowserZone, () => null);

/** Los nombres de zona vienen en inglés y sin tildes; estas son las de casi todo el público. */
const CITY: Record<string, string> = {
  Bogota: "Bogotá",
  Mexico_City: "Ciudad de México",
  Cancun: "Cancún",
  Merida: "Mérida",
  Panama: "Panamá",
  Asuncion: "Asunción",
  Sao_Paulo: "São Paulo",
  New_York: "Nueva York",
  Los_Angeles: "Los Ángeles",
  London: "Londres",
  Paris: "París",
  Berlin: "Berlín",
  Rome: "Roma",
  Lisbon: "Lisboa",
  Canary: "Canarias",
};

/** «Bogotá», «Ciudad de México», «Buenos Aires»: la ciudad del nombre de la zona. */
const zoneCity = (tz: string): string => {
  const last = tz.split("/").pop() || tz;
  return CITY[last] ?? last.replace(/_/g, " ");
};

/** «GMT-5», en la fecha de esas horas (cambia con el horario de verano). `null` si el navegador no lo da. */
const zoneOffset = (tz: string, at: Date): string | null => {
  try {
    const options = { timeZone: tz, timeZoneName: "shortOffset" } as Intl.DateTimeFormatOptions;
    return new Intl.DateTimeFormat("es-CO", options).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? null;
  } catch {
    return null;
  }
};

// ── Las horas, por día ──────────────────────────────────────────────────────

type Day = { key: string; firstIso: string; slots: Slot[] };

/** La fecha de calendario de un instante en esa zona («2026-11-12»): solo sirve de clave. */
const dayKeyFormatter = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });

const groupByDay = (slots: Slot[], tz: string): Day[] => {
  const keyOf = dayKeyFormatter(tz);
  const days = new Map<string, Day>();
  for (const slot of [...slots].sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))) {
    const key = keyOf.format(new Date(slot.startIso));
    const day = days.get(key);
    if (day) day.slots.push(slot);
    else days.set(key, { key, firstIso: slot.startIso, slots: [slot] });
  }
  return [...days.values()];
};

/** Lo que llega de la red, leído con cuidado, sin repetidos y sin horas que ya pasaron. */
const cleanSlots = (raw: unknown): Slot[] => {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const seen = new Set<number>();
  const out: Slot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { startIso, endIso } = item as { startIso?: unknown; endIso?: unknown };
    if (typeof startIso !== "string" || typeof endIso !== "string") continue;
    const at = Date.parse(startIso);
    if (!Number.isFinite(at) || !Number.isFinite(Date.parse(endIso)) || at <= now || seen.has(at)) continue;
    seen.add(at);
    out.push({ startIso, endIso });
  }
  return out;
};

const sameInstant = (a: string | null | undefined, b: string | null | undefined): boolean =>
  Boolean(a && b) && Date.parse(a as string) === Date.parse(b as string);

// ── Estados ─────────────────────────────────────────────────────────────────

/** Por qué no hay horas que mostrar. */
type Unavailable =
  /** La página o la agenda están apagadas. */
  | "closed"
  /** El calendario no respondió. */
  | "calendar"
  /** No hay horas libres en los próximos días. */
  | "empty"
  /** La hora elegida se ocupó y no quedó ninguna otra. */
  | "gone"
  /** Sin conexión (o una respuesta que no se entiende). */
  | "network"
  /** Demasiadas consultas desde esta conexión. */
  | "busy";

/** Por qué no se pudo agendar con este enlace. */
type Blocked = "already_booked" | "closed" | "not_found";

type View =
  | { kind: "loading" }
  | { kind: "ready"; slots: Slot[] }
  | { kind: "unavailable"; reason: Unavailable }
  | { kind: "blocked"; reason: Blocked };

const UNAVAILABLE_TEXT: Record<Unavailable, string> = {
  closed: "Por ahora no se puede agendar desde la página.",
  calendar: "No pudimos cargar las horas en este momento.",
  empty: "No quedan horas libres en los próximos días.",
  gone: "Esa hora se acaba de ocupar y ya no quedan más horas libres en los próximos días.",
  network: "No pudimos cargar las horas. Revisa tu conexión a internet.",
  busy: "Hay muchas consultas en este momento. Espera un minuto y vuelve a intentar.",
};

/** Con cuáles tiene sentido volver a intentar (las demás no cambian en un minuto). */
const CAN_RETRY: Record<Unavailable, boolean> = { closed: false, calendar: true, empty: false, gone: false, network: true, busy: true };

const BLOCKED_TEXT: Record<Blocked, string> = {
  already_booked: "Ya hay una llamada agendada con este número. Si quieres cambiarla o no la reconoces, escríbenos por WhatsApp.",
  closed: "En este momento no podemos agendar tu llamada desde la página. Escríbenos por WhatsApp y la agendamos contigo.",
  not_found: "No pudimos encontrar tu registro con este enlace. Escríbenos por WhatsApp y lo resolvemos.",
};

type Notice = { text: string; help: boolean };

type HoursResult =
  | { kind: "ok"; slots: Slot[] }
  /** Lo dijo el servidor: no hay horas que mostrar. */
  | { kind: "unavailable"; reason: "closed" | "calendar" | "empty" }
  /** No se pudo preguntar (sin conexión, demasiadas consultas). */
  | { kind: "failed"; reason: "network" | "busy" };

/** `GET /api/llamada/horas`. Nunca lanza. */
const requestHours = async (): Promise<HoursResult> => {
  try {
    const res = await fetch("/api/llamada/horas", { cache: "no-store" });
    if (res.status === 429) return { kind: "failed", reason: "busy" };
    const data = (await res.json()) as { state?: unknown; slots?: unknown; reason?: unknown } | null;
    if (data?.state === "ok") return { kind: "ok", slots: cleanSlots(data.slots) };
    if (data?.state === "unavailable") {
      return { kind: "unavailable", reason: data.reason === "closed" || data.reason === "empty" ? data.reason : "calendar" };
    }
    return { kind: "failed", reason: "network" };
  } catch {
    return { kind: "failed", reason: "network" };
  }
};

// ── Piezas ──────────────────────────────────────────────────────────────────

const HelpButton = ({ href, primary = false }: { href: string; primary?: boolean }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={primary ? primaryBtn : secondaryBtn}>
    <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
    Escríbenos por WhatsApp
  </a>
);

const skeletonBar = "rounded-xl bg-muted motion-safe:animate-pulse";

/** El hueco del selector mientras llegan las horas (o mientras se sabe la zona del navegador). */
export const SlotPickerSkeleton = () => (
  <div role="status" aria-busy="true" className="flex flex-col gap-4" data-testid="llamada-horas-cargando">
    <span className="sr-only">Cargando las horas disponibles…</span>
    <div aria-hidden="true" className={`h-4 w-44 ${skeletonBar}`} />
    <div aria-hidden="true" className="grid grid-cols-3 gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`h-14 ${skeletonBar}`} />
      ))}
    </div>
    <div aria-hidden="true" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={`h-13 ${skeletonBar}`} />
      ))}
    </div>
    <div aria-hidden="true" className="h-13 rounded-full bg-muted motion-safe:animate-pulse" />
  </div>
);

// ── El selector ─────────────────────────────────────────────────────────────

export function SlotPicker({ token, submitLabel, currentStartIso = null, onBooked, helpUrl }: SlotPickerProps): JSX.Element {
  const seed = useContext(SeedContext);
  const tz = useBrowserZone();
  const groupId = useId();

  /** El «ahora» de cuando abrió el selector: para «Hoy» y «Mañana». */
  const [openedAt] = useState(() => Date.now());
  const [view, setView] = useState<View>(() => {
    const seeded = seed ? cleanSlots(seed.slots) : [];
    return seeded.length ? { kind: "ready", slots: seeded } : { kind: "loading" };
  });
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** La hora que se agendó aquí (lo mismo en `bookedRef`, que no espera al render). */
  const [bookedIso, setBookedIso] = useState<string | null>(null);
  const bookedRef = useRef<string | null>(null);
  /** El candado contra el doble toque: el estado tarda un render en llegar al botón. */
  const busy = useRef(false);
  const alive = useRef(true);

  /**
   * Recién agendada: el selector se queda quieto mientras quien lo usa decide
   * qué sigue (`onBooked`: ir a otra página, refrescar). Si lo deja montado y
   * le pasa esa hora como la actual (`currentStartIso`), vuelve a servir para
   * cambiarla otra vez.
   */
  const settled = bookedIso !== null && !sameInstant(bookedIso, currentStartIso);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Lo que contestó `/horas`, a la pantalla. Si no se pudo preguntar y ya había
   * horas a la vista (las que trajo la página del servidor), se quedan: agendar
   * las vuelve a comprobar de todos modos. Mientras se está agendando, o recién
   * agendada, la lista no se toca. Cuando quien usa el selector pasa la hora
   * nueva como la actual, esta función cambia y las horas se piden otra vez.
   */
  const showHours = useCallback(
    (result: HoursResult) => {
      if (!alive.current || busy.current) return;
      if (bookedRef.current !== null && !sameInstant(bookedRef.current, currentStartIso)) return;
      setView((v) => {
        if (v.kind === "blocked") return v;
        if (result.kind === "failed") return v.kind === "loading" ? { kind: "unavailable", reason: result.reason } : v;
        if (result.kind === "unavailable") return { kind: "unavailable", reason: result.reason };
        return result.slots.length ? { kind: "ready", slots: result.slots } : { kind: "unavailable", reason: "empty" };
      });
    },
    [currentStartIso]
  );

  useEffect(() => {
    void requestHours().then(showHours);
  }, [showHours]);

  const retry = () => {
    setNotice(null);
    setSelected(null);
    setView({ kind: "loading" });
    void requestHours().then(showHours);
  };

  const slots = view.kind === "ready" ? view.slots : null;
  const days = useMemo(() => (slots && tz ? groupByDay(slots, tz) : []), [slots, tz]);
  const activeDay = days.find((d) => d.key === dayKey) ?? days[0] ?? null;
  /** La hora elegida solo cuenta si sigue en la lista y es del día que se ve. */
  const chosen = activeDay?.slots.find((s) => s.startIso === selected) ?? null;
  const chosenIsCurrent = sameInstant(chosen?.startIso, currentStartIso);

  const relativeDay = useMemo(() => {
    if (!tz) return new Map<string, string>();
    const keyOf = dayKeyFormatter(tz);
    return new Map([
      [keyOf.format(new Date(openedAt)), "Hoy"],
      [keyOf.format(new Date(openedAt + 86_400_000)), "Mañana"],
    ]);
  }, [tz, openedAt]);

  const chipFormat = useMemo(
    () =>
      tz
        ? {
            weekday: new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long" }),
            date: new Intl.DateTimeFormat("es-CO", { timeZone: tz, day: "numeric", month: "short" }),
          }
        : null,
    [tz]
  );

  const submit = async () => {
    const justBooked = bookedRef.current !== null && !sameInstant(bookedRef.current, currentStartIso);
    if (busy.current || justBooked || !chosen || chosenIsCurrent) return;
    busy.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/llamada/${encodeURIComponent(token)}/agendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startIso: chosen.startIso }),
      });
      const data = (await res.json().catch(() => null)) as {
        status?: unknown;
        startIso?: unknown;
        endIso?: unknown;
        moved?: unknown;
        slots?: unknown;
      } | null;
      if (!alive.current) return;

      if (res.ok && data?.status === "booked") {
        const startIso = typeof data.startIso === "string" ? data.startIso : chosen.startIso;
        bookedRef.current = startIso;
        setBookedIso(startIso);
        onBooked({ startIso, endIso: typeof data.endIso === "string" ? data.endIso : chosen.endIso, moved: data.moved === true });
      } else if (data?.status === "unavailable") {
        // Esa hora se ocupó (o el día se llenó): la lista de ahora reemplaza a la vieja.
        const fresh = cleanSlots(data.slots);
        setSelected(null);
        if (fresh.length) {
          setView({ kind: "ready", slots: fresh });
          setNotice({ text: "Esa hora se acaba de ocupar. Elige otra.", help: false });
        } else {
          setView({ kind: "unavailable", reason: "gone" });
        }
      } else if (data?.status === "already_booked" || data?.status === "closed" || data?.status === "not_found") {
        setView({ kind: "blocked", reason: data.status });
      } else if (res.status === 429) {
        setNotice({ text: "Demasiados intentos seguidos. Espera un minuto y vuelve a tocar el botón.", help: false });
      } else {
        // Una respuesta que no es del contrato (un 400, un 500): se puede reintentar, y WhatsApp queda a mano.
        setNotice({ text: "No pudimos agendar tu llamada. Inténtalo de nuevo; si sigue fallando, escríbenos por WhatsApp.", help: true });
      }
    } catch {
      if (alive.current) {
        setNotice({ text: "No pudimos conectar. Revisa tu internet e inténtalo de nuevo, o escríbenos por WhatsApp.", help: true });
      }
    } finally {
      busy.current = false;
      if (alive.current) setSubmitting(false);
    }
  };

  // ── Lo que se ve ──────────────────────────────────────────────────────────

  if (view.kind === "blocked") {
    return (
      <div className="flex flex-col gap-4" data-testid="llamada-horas-bloqueado">
        <p role="alert" className="font-[font1] text-base leading-relaxed text-foreground">
          {BLOCKED_TEXT[view.reason]}
        </p>
        <HelpButton href={helpUrl} primary />
        {view.reason === "closed" ? (
          <button type="button" onClick={retry} className={secondaryBtn}>
            Intentar de nuevo
          </button>
        ) : null}
      </div>
    );
  }

  if (view.kind === "unavailable") {
    return (
      <div className="flex flex-col gap-4" data-testid="llamada-horas-sin-horas">
        <div role="alert" className="font-[font1] text-base leading-relaxed text-foreground">
          <p>{UNAVAILABLE_TEXT[view.reason]}</p>
          <p className="mt-1.5 text-muted-foreground">Escríbenos por WhatsApp y te ayudamos a encontrar tu hora.</p>
        </div>
        <HelpButton href={helpUrl} primary />
        {CAN_RETRY[view.reason] ? (
          <button type="button" onClick={retry} className={secondaryBtn}>
            Volver a intentar
          </button>
        ) : null}
      </div>
    );
  }

  // Cargando, o con horas pero sin saber todavía la zona (en el servidor y al hidratar).
  if (view.kind === "loading" || !tz || !activeDay || !chipFormat) return <SlotPickerSkeleton />;

  const locked = submitting || settled;
  const offset = zoneOffset(tz, new Date(activeDay.firstIso));
  const currentIsValid = Boolean(currentStartIso) && Number.isFinite(Date.parse(currentStartIso as string));

  return (
    <div className="flex flex-col gap-5" data-testid="llamada-horas">
      <div className="font-[font1] text-sm leading-relaxed text-muted-foreground">
        <p>
          Horas en tu zona: <span className="font-[font2] text-foreground">{zoneCity(tz)}</span>
          {offset ? ` (${offset})` : ""}
        </p>
        {currentIsValid ? (
          <p className="mt-1">
            Tu llamada actual: <span className="font-[font2] text-foreground">{whenLabel(currentStartIso as string, tz)}</span>
          </p>
        ) : null}
      </div>

      {notice ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="font-[font1] text-sm leading-relaxed text-foreground">{notice.text}</p>
          {notice.help ? <HelpButton href={helpUrl} /> : null}
        </div>
      ) : null}

      <fieldset disabled={locked} className="min-w-0">
        <legend className="mb-2 font-[font2] text-sm text-foreground">Día</legend>
        <div className="-mx-1 grid grid-flow-col auto-cols-[minmax(5.75rem,1fr)] gap-2 overflow-x-auto px-1 py-1">
          {days.map((day) => {
            const at = new Date(day.firstIso);
            return (
              <label key={day.key} className="relative block">
                <input
                  type="radio"
                  name={`${groupId}-dia`}
                  value={day.key}
                  checked={day.key === activeDay.key}
                  onChange={() => {
                    setDayKey(day.key);
                    setSelected(null);
                  }}
                  className="peer sr-only"
                />
                <span className={`${optionBox} flex-col justify-center gap-0.5 px-2 text-center`}>
                  <span className="font-[font2] text-sm leading-tight first-letter:uppercase">
                    {relativeDay.get(day.key) ?? chipFormat.weekday.format(at)}
                  </span>
                  <span className="font-[font1] text-xs leading-tight opacity-80">{chipFormat.date.format(at)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset disabled={locked} className="min-w-0">
        <legend className="mb-2 font-[font2] text-sm text-foreground first-letter:uppercase">{dayLabel(activeDay.firstIso, tz)}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {activeDay.slots.map((slot) => {
            const isCurrent = sameInstant(slot.startIso, currentStartIso);
            return (
              <label key={slot.startIso} className="relative block">
                <input
                  type="radio"
                  name={`${groupId}-hora`}
                  value={slot.startIso}
                  checked={slot.startIso === chosen?.startIso}
                  onChange={() => {
                    setSelected(slot.startIso);
                    setNotice(null);
                  }}
                  disabled={isCurrent}
                  className="peer sr-only"
                />
                <span className={`${optionBox} flex-col justify-center px-2 text-center font-[font2]`}>
                  {timeLabel(slot.startIso, tz)}
                  {isCurrent ? <span className="font-[font1] text-xs leading-tight">Tu hora actual</span> : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {settled && bookedIso ? (
        <p role="status" className="font-[font1] text-base leading-relaxed text-foreground" data-testid="llamada-horas-agendada">
          Tu llamada quedó agendada: <span className="font-[font2]">{whenLabel(bookedIso, tz)}</span>.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p aria-live="polite" className="min-h-5 font-[font1] text-sm leading-snug text-muted-foreground">
            {chosen ? (
              <>
                Elegiste: <span className="font-[font2] text-foreground">{whenLabel(chosen.startIso, tz)}</span>
              </>
            ) : (
              "Toca una hora para elegirla."
            )}
          </p>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !chosen || chosenIsCurrent}
            aria-busy={submitting}
            className={primaryBtn}
          >
            {submitting ? "Un momento…" : submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export default SlotPicker;
