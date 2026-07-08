"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

const inputClass =
  "w-full rounded-xl border border-linen/20 bg-black/30 px-4 py-3.5 font-[font1] text-sm text-white placeholder-white/30 transition-colors focus:border-terracotta focus:outline-none";

const labelClass =
  "mb-2 block font-[font2] uppercase text-[10px] tracking-[0.22em] text-white/50";

const MIN_LENGTH = 12;

/**
 * Open self-service signup: email + password (+ Google) creates the
 * account — and the lead Contact if the email is new — immediately, then
 * logs in. No email has to arrive for someone to get in. Course access
 * itself stays gated by membership.isCurrent once inside the portal.
 */
const MemberSignupForm = ({ googleEnabled }: { googleEnabled: boolean }) => {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/miembros";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/miembros/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: name.trim() || undefined }),
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
    <div className="space-y-5">
      {googleEnabled ? (
        <>
          <button
            type="button"
            onClick={() => signIn("google", { redirectTo: callbackUrl })}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-linen/20 bg-black/20 py-3.5 font-[font1] text-sm text-white/90 transition-colors hover:border-linen/40 hover:bg-linen/[0.06]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#EA4335"
                d="M12 5.04c1.72 0 3.26.59 4.47 1.75l3.32-3.32C17.78 1.6 15.1.5 12 .5 7.42.5 3.44 3.13 1.5 6.96l3.87 3C6.29 7.14 8.9 5.04 12 5.04Z"
              />
              <path
                fill="#4285F4"
                d="M23.5 12.27c0-.94-.08-1.63-.26-2.35H12v4.45h6.56c-.13 1.1-.85 2.76-2.44 3.87l3.78 2.93c2.26-2.09 3.6-5.17 3.6-8.9Z"
              />
              <path
                fill="#FBBC05"
                d="M5.38 14.04a7.2 7.2 0 0 1-.38-2.29c0-.8.14-1.57.37-2.29l-3.87-3A11.96 11.96 0 0 0 .25 11.75c0 1.93.46 3.75 1.25 5.29l3.88-3Z"
              />
              <path
                fill="#34A853"
                d="M12 23c3.1 0 5.7-1.02 7.6-2.78l-3.78-2.93c-1.01.7-2.36 1.2-3.82 1.2-3.1 0-5.71-2.1-6.63-4.95l-3.87 3C3.44 20.37 7.42 23 12 23Z"
              />
            </svg>
            Continuar con Google
          </button>

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-linen/15" />
            <span className="font-[font1] text-[11px] text-white/35">o</span>
            <span className="h-px flex-1 bg-linen/15" />
          </div>
        </>
      ) : null}

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className={labelClass}>Nombre (opcional)</span>
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="¿Cómo te llamamos?"
            className={inputClass}
          />
        </label>

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
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={MIN_LENGTH}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`Mínimo ${MIN_LENGTH} caracteres`}
              className={`${inputClass} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-white/40 transition-colors hover:text-white/80"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {password.length > 0 && (
            <p
              className={`mt-1.5 font-[font1] text-[11px] ${
                password.length >= MIN_LENGTH ? "text-emerald-400/80" : "text-white/40"
              }`}
            >
              {password.length}/{MIN_LENGTH} caracteres mínimos
            </p>
          )}
        </label>

        <label className="block">
          <span className={labelClass}>Confírmala</span>
          <input
            type={showPassword ? "text" : "password"}
            required
            minLength={MIN_LENGTH}
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
    </div>
  );
};

export default MemberSignupForm;
