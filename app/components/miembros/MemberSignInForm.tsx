"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

const inputClass =
  "w-full rounded-lg border border-linen/20 bg-black/40 px-4 py-3 font-[font1] text-sm text-white placeholder-white/30 transition-colors focus:border-linen/50 focus:outline-none";

const labelClass =
  "mb-2 block font-[font2] uppercase text-[10px] tracking-[0.25em] text-white/50";

const MemberSignInForm = ({ googleEnabled }: { googleEnabled: boolean }) => {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/miembros";
  const oauthError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    oauthError
      ? "No pudimos completar el acceso con Google. Intenta con tu correo y contraseña."
      : null
  );
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    setLoading(false);

    if (result?.error) {
      setError(
        "No pudimos iniciar sesión. Revisa tu correo y contraseña, o crea tu cuenta si aún no tienes una."
      );
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
            className="flex w-full items-center justify-center gap-3 rounded-full border border-linen/25 py-3.5 font-[font2] uppercase text-xs tracking-[0.2em] text-white/85 transition-colors hover:bg-linen/5 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
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

          <div className="flex items-center gap-4">
            <span className="h-px flex-1 bg-linen/15" />
            <span className="font-[font1] text-[11px] text-white/40">
              o con tu correo
            </span>
            <span className="h-px flex-1 bg-linen/15" />
          </div>
        </>
      ) : null}

      <form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className={labelClass}>Email</span>
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
          <span className={labelClass}>Contraseña</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>

        {error && (
          <p className="font-[font1] text-sm text-blush" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-linen py-3.5 font-[font2] uppercase text-xs tracking-[0.25em] text-black transition-colors hover:bg-white disabled:opacity-60"
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <div className="space-y-2 pt-1 text-center font-[font1] text-[13px] text-white/50">
        <p>
          ¿Primera vez aquí?{" "}
          <Link
            href="/miembros/crear-cuenta"
            className="text-linen underline-offset-4 hover:underline"
          >
            Crea tu cuenta
          </Link>
        </p>
        <p>
          <Link
            href="/miembros/recuperar"
            className="text-white/50 underline-offset-4 hover:text-white hover:underline"
          >
            Olvidé mi contraseña
          </Link>
        </p>
      </div>
    </div>
  );
};

export default MemberSignInForm;
