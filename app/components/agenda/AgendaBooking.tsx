"use client";

import { useState } from "react";

/**
 * Elegir hueco y reservar, en una sola pantalla.
 *
 * Primero el día, luego la hora, y solo entonces los datos: pedir el correo
 * antes de que la persona haya visto que existe un hueco que le sirve es la
 * forma más rápida de que se vaya.
 */

export type DaySlots = {
  dateKey: string;
  slots: { startIso: string; label: string }[];
};

type Booked = {
  startsAt: string;
  meetUrl: string | null;
  cancelUrl: string;
};

const ERRORS: Record<string, string> = {
  missing_name: "Escribe tu nombre.",
  invalid_email: "Ese correo no parece válido.",
  slot_taken: "Alguien tomó esa hora hace un momento. Elige otra.",
  invalid_slot: "Esa hora ya no está disponible.",
  closed: "La agenda está cerrada por ahora.",
  rate_limited: "Demasiados intentos. Espera un minuto.",
};

const dayLabel = (dateKey: string, timezone: string) =>
  new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  }).format(new Date(`${dateKey}T12:00:00Z`));

const whenLabel = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(iso));

const AgendaBooking = ({
  days,
  timezone,
  source,
}: {
  days: DaySlots[];
  timezone: string;
  source?: string;
}) => {
  const [dateKey, setDateKey] = useState<string | null>(days[0]?.dateKey ?? null);
  const [startIso, setStartIso] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);

  const day = days.find((d) => d.dateKey === dateKey) ?? days[0];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startIso) return;
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startIso, name, email, phone, note, source }),
      });
      const data = (await res.json().catch(() => ({}))) as Booked & { error?: string };
      if (!res.ok) {
        setError(ERRORS[data.error ?? ""] ?? "No se pudo reservar. Intenta de nuevo.");
        return;
      }
      setBooked(data);
    } catch {
      setError("Error de red. Intenta de nuevo.");
    } finally {
      setSending(false);
    }
  };

  if (booked) {
    return (
      <div className="mt-8 rounded-3xl border border-emerald-700/25 bg-emerald-700/[0.06] p-6">
        <p className="font-[font2] text-[10px] uppercase tracking-[0.25em] text-emerald-800">
          Cita confirmada
        </p>
        <p className="mt-3 font-[font1] text-lg leading-snug text-black/80">
          {whenLabel(booked.startsAt, timezone)}
        </p>
        <p className="mt-2 font-[font1] text-sm text-black/60">
          Te lo enviamos a {email}. Revisa spam si no lo ves.
        </p>
        {booked.meetUrl && (
          <a
            href={booked.meetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center justify-center rounded-full bg-terracotta px-6 py-3 font-[font2] text-xs uppercase tracking-[0.24em] text-white"
          >
            Enlace de la videollamada
          </a>
        )}
        <p className="mt-4 font-[font1] text-xs text-black/50">
          ¿No puedes?{" "}
          <a href={booked.cancelUrl} className="underline underline-offset-2">
            Cancela aquí
          </a>{" "}
          y liberas el espacio.
        </p>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <p className="mt-8 font-[font1] text-base leading-snug text-black/60">
        Ahora mismo no hay horas libres. Vuelve a mirar mañana o escríbeme por
        WhatsApp y buscamos un espacio.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8">
      <p className="font-[font2] text-[10px] uppercase tracking-[0.24em] text-black/45">
        Elige el día
      </p>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.dateKey}
            type="button"
            onClick={() => {
              setDateKey(d.dateKey);
              setStartIso(null);
            }}
            className={`shrink-0 rounded-full border px-4 py-2 font-[font1] text-sm capitalize transition-colors ${
              d.dateKey === day?.dateKey
                ? "border-black bg-[#141118] text-linen"
                : "border-black/15 bg-white text-black/70 hover:border-black/40"
            }`}
          >
            {dayLabel(d.dateKey, timezone)}
          </button>
        ))}
      </div>

      <p className="mt-6 font-[font2] text-[10px] uppercase tracking-[0.24em] text-black/45">
        Elige la hora
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {day?.slots.map((s) => (
          <button
            key={s.startIso}
            type="button"
            onClick={() => setStartIso(s.startIso)}
            className={`rounded-xl border px-2 py-2.5 font-[font1] text-sm transition-colors ${
              s.startIso === startIso
                ? "border-terracotta bg-terracotta text-white"
                : "border-black/15 bg-white text-black/75 hover:border-black/40"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {startIso && (
        <div className="mt-6 flex flex-col gap-3">
          <label className="font-[font1] text-xs uppercase tracking-[0.2em] text-black/50">
            Tu nombre
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="given-name"
              className="mt-1.5 w-full rounded-xl border border-black/15 bg-white px-4 py-3 font-[font1] text-base normal-case tracking-normal text-[#141118]"
            />
          </label>

          <label className="font-[font1] text-xs uppercase tracking-[0.2em] text-black/50">
            Tu correo
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              required
              autoComplete="email"
              className="mt-1.5 w-full rounded-xl border border-black/15 bg-white px-4 py-3 font-[font1] text-base normal-case tracking-normal text-[#141118]"
            />
          </label>

          <label className="font-[font1] text-xs uppercase tracking-[0.2em] text-black/50">
            WhatsApp (opcional)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+57 300 000 0000"
              className="mt-1.5 w-full rounded-xl border border-black/15 bg-white px-4 py-3 font-[font1] text-base normal-case tracking-normal text-[#141118]"
            />
          </label>

          <label className="font-[font1] text-xs uppercase tracking-[0.2em] text-black/50">
            ¿En qué quieres trabajar? (opcional)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-xl border border-black/15 bg-white px-4 py-3 font-[font1] text-base normal-case tracking-normal text-[#141118]"
            />
          </label>

          {error && (
            <p role="alert" className="font-[font1] text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={sending}
            className="mt-1 w-full cursor-pointer rounded-full bg-[#141118] px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.28em] text-linen transition-all duration-200 hover:-translate-y-0.5 hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Reservando…" : "Confirmar mi cita"}
          </button>
        </div>
      )}
    </form>
  );
};

export default AgendaBooking;
