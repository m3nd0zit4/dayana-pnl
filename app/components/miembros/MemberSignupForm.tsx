"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

const inputClass =
  "w-full rounded-xl border border-linen/20 bg-black/30 px-4 py-3.5 font-[font1] text-sm text-white placeholder-white/30 transition-colors focus:border-terracotta focus:outline-none";

const labelClass =
  "mb-2 block font-[font2] uppercase text-[10px] tracking-[0.22em] text-white/50";

/**
 * Open self-service signup: email + password creates the account (and the
 * lead Contact if the email is new) immediately, then logs in — no email
 * has to arrive for someone to get in. Course access itself stays gated by
 * membership.isCurrent once they're inside the portal.
 */
const MemberSignupForm = () => {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/miembros";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/miembros/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      setLoading(false);
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (data?.error === "already_registered") {
        setError("Ya tienes cuenta con este correo — inicia sesión abajo.");
      } else if (data?.error === "weak_password" && data.message) {
        setError(data.message);
      } else if (data?.error === "rate_limited") {
        setError("Demasiados intentos. Espera unos minutos y vuelve a intentar.");
      } else {
        setError("Algo salió mal. Intenta de nuevo.");
      }
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setLoading(false);

    if (result?.error) {
      setError("Tu cuenta se creó, pero no pudimos entrar automáticamente. Inicia sesión.");
      return;
    }

    window.location.href = result?.url ?? callbackUrl;
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className={labelClass}>Correo electrónico</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className={labelClass}>Crea una contraseña</span>
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 12 caracteres"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className={labelClass}>Confírmala</span>
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
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
        {loading ? "Creando cuenta…" : "Crear mi cuenta"}
      </button>

      <p className="text-center font-[font1] text-[13px] text-white/50">
        ¿Ya tienes cuenta?{" "}
        <Link href="/acceso" className="text-linen underline-offset-4 hover:underline">
          Inicia sesión
        </Link>
      </p>
    </form>
  );
};

export default MemberSignupForm;
