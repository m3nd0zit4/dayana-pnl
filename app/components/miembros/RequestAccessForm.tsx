"use client";

import Link from "next/link";
import { useState } from "react";

const RequestAccessForm = ({ buttonLabel }: { buttonLabel: string }) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/miembros/auth/request-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    setLoading(false);

    if (res.status === 429) {
      setError("Demasiados intentos. Espera unos minutos y vuelve a intentar.");
      return;
    }
    if (!res.ok) {
      setError("Algo salió mal. Intenta de nuevo.");
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="space-y-4">
        <p className="font-[font1] text-sm leading-relaxed text-black/75">
          Si tu correo está registrado con nosotros, te enviamos un enlace para
          continuar. Revisa tu bandeja de entrada (y la carpeta de spam).
        </p>
        <p className="font-[font1] text-[13px] text-black/50">
          ¿No te llega?{" "}
          <Link
            href="/"
            className="text-[#141118] underline-offset-4 hover:underline"
          >
            Escríbenos por WhatsApp
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-2 block font-[font2] uppercase text-[10px] tracking-[0.22em] text-black/55">
          Correo electrónico
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          className="w-full rounded-xl border border-black/15 bg-black/[0.03] px-4 py-3.5 font-[font1] text-sm text-[#141118] placeholder-black/35 transition-colors focus:border-terracotta focus:outline-none"
        />
      </label>

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
        {loading ? "Enviando…" : buttonLabel}
      </button>

      <p className="text-center font-[font1] text-[13px] text-black/50">
        ¿Ya tienes cuenta?{" "}
        <Link
          href="/acceso"
          className="text-[#141118] underline-offset-4 hover:underline"
        >
          Inicia sesión
        </Link>
      </p>
    </form>
  );
};

export default RequestAccessForm;
