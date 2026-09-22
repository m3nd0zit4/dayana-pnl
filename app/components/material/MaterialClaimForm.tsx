"use client";

import { useState } from "react";

/**
 * El formulario de «déjame tu correo y te lo mando».
 *
 * Dos campos y nada más. Quien llega aquí viene de un comentario en TikTok:
 * cada campo de sobra es gente que se va sin el material y sin quedar en el
 * CRM. El material aparece en esta misma pantalla al enviar — el correo es la
 * copia, no la entrega.
 */

type Delivered = {
  title: string;
  deliveryUrl: string;
  alreadyClaimed: boolean;
};

const ERRORS: Record<string, string> = {
  missing_name: "Escribe tu nombre.",
  invalid_email: "Ese correo no parece válido.",
  rate_limited: "Demasiados intentos. Espera un minuto y vuelve a probar.",
  not_found: "Esta palabra ya no está disponible.",
};

const MaterialClaimForm = ({
  keyword,
  source,
}: {
  keyword: string;
  /** De dónde viene (tiktok, instagram…), para saber qué video trae gente. */
  source?: string;
}) => {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Delivered | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/material/${encodeURIComponent(keyword)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, email, source }),
      });
      const data = (await res.json().catch(() => ({}))) as Delivered & {
        error?: string;
      };
      if (!res.ok || !data.deliveryUrl) {
        setError(ERRORS[data.error ?? ""] ?? "No se pudo enviar. Intenta de nuevo.");
        return;
      }
      setDone(data);
      // Se abre solo: quien viene de un video espera el material, no otro clic.
      window.open(data.deliveryUrl, "_blank", "noopener");
    } catch {
      setError("Error de red. Intenta de nuevo.");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="mt-8">
        <p className="font-[font1] text-base leading-snug text-black/70">
          {done.alreadyClaimed
            ? "Ya lo tenías: aquí está otra vez."
            : `Listo. También te lo enviamos a ${email}.`}
        </p>
        <a
          href={done.deliveryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-terracotta px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.24em] text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c]"
        >
          Abrir el material
        </a>
        <p className="mt-4 text-center font-[font1] text-xs text-black/45">
          Si no lo ves en el correo, revisa spam o promociones.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
      <label className="font-[font1] text-xs uppercase tracking-[0.2em] text-black/50">
        Tu nombre
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          autoComplete="given-name"
          required
          className="mt-1.5 w-full rounded-xl border border-black/15 bg-white px-4 py-3 font-[font1] text-base normal-case tracking-normal text-[#141118] placeholder:text-black/30"
          placeholder="Cómo te llamas"
        />
      </label>

      <label className="font-[font1] text-xs uppercase tracking-[0.2em] text-black/50">
        Tu correo
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className="mt-1.5 w-full rounded-xl border border-black/15 bg-white px-4 py-3 font-[font1] text-base normal-case tracking-normal text-[#141118] placeholder:text-black/30"
          placeholder="tucorreo@ejemplo.com"
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
        {sending ? "Enviando…" : "Quiero el material"}
      </button>

      <p className="text-center font-[font1] text-[11px] leading-relaxed text-black/45">
        Te llega al instante. Nada de spam: puedes salirte cuando quieras.
      </p>
    </form>
  );
};

export default MaterialClaimForm;
