"use client";

import Link from "next/link";
import { getSession, signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import GoogleAuthButton from "./GoogleAuthButton";

const inputClass =
  "w-full rounded-xl border border-black/15 bg-black/[0.03] px-4 py-3.5 font-[font1] text-sm text-[#141118] placeholder-black/35 transition-colors focus:border-terracotta focus:outline-none";

const labelClass =
  "mb-2 block font-[font2] uppercase text-[10px] tracking-[0.22em] text-black/55";

type MemberSignInFormProps = {
  googleEnabled: boolean;
  /** Overrides the ?callbackUrl= query param — for inline embeds (e.g. the
   *  workshop payment gate) where the URL carries no callback. */
  callbackUrl?: string;
  /** Inline embeds: called on successful credentials sign-in instead of
   *  navigating to callbackUrl. */
  onSuccess?: () => void;
  initialEmail?: string;
  /** Inline embeds: flip the host UI to the signup wizard instead of
   *  navigating to /miembros/crear-cuenta. */
  onSwitchToSignup?: () => void;
};

const MemberSignInForm = ({
  googleEnabled,
  callbackUrl: callbackUrlProp,
  onSuccess,
  initialEmail,
  onSwitchToSignup,
}: MemberSignInFormProps) => {
  const searchParams = useSearchParams();
  const explicitCallbackUrl = callbackUrlProp ?? searchParams.get("callbackUrl");
  const callbackUrl = explicitCallbackUrl ?? "/miembros";
  const oauthError = searchParams.get("error");
  const [email, setEmail] = useState(initialEmail ?? "");
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
      setError("Correo o contraseña incorrectos.");
      return;
    }

    if (onSuccess) {
      onSuccess();
      return;
    }

    // No explicit destination was requested (a plain /acceso visit, not a
    // deep link) — if this account also has CRM access, let her choose
    // instead of silently landing in the course portal. proxy.ts applies
    // the same rule when she revisits /acceso already signed in.
    if (!explicitCallbackUrl) {
      const session = await getSession();
      if (session?.user?.kind === "staff" && session.user.role === "OWNER") {
        window.location.href = "/acceso/portal";
        return;
      }
    }

    window.location.href = result?.url ?? callbackUrl;
  };

  return (
    <div className="space-y-5">
      {googleEnabled ? (
        <>
          <GoogleAuthButton callbackUrl={callbackUrl} />

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-linen/15" />
            <span className="font-[font1] text-[11px] text-black/40">o</span>
            <span className="h-px flex-1 bg-linen/15" />
          </div>
        </>
      ) : null}

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
          <span className={labelClass}>Contraseña</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <div className="mt-2 text-right">
            <Link
              href="/miembros/recuperar"
              className="font-[font1] text-[12px] text-black/45 transition-colors hover:text-terracotta"
            >
              Olvidé mi contraseña
            </Link>
          </div>
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
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <p className="pt-1 text-center font-[font1] text-[13px] text-black/50">
        ¿Primera vez aquí?{" "}
        {onSwitchToSignup ? (
          <button
            type="button"
            onClick={onSwitchToSignup}
            className="text-[#141118] underline-offset-4 hover:underline"
          >
            Crea tu cuenta
          </button>
        ) : (
          <Link
            href={
              callbackUrl !== "/miembros"
                ? `/miembros/crear-cuenta?callbackUrl=${encodeURIComponent(callbackUrl)}`
                : "/miembros/crear-cuenta"
            }
            className="text-[#141118] underline-offset-4 hover:underline"
          >
            Crea tu cuenta
          </Link>
        )}
      </p>
    </div>
  );
};

export default MemberSignInForm;
