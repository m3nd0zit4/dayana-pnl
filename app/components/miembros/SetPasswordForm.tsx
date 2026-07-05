"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

const inputClass =
  "w-full rounded-lg border border-linen/20 bg-black/40 px-4 py-3 font-[font1] text-sm text-white placeholder-white/30 transition-colors focus:border-linen/50 focus:outline-none";

const labelClass =
  "mb-2 block font-[font2] uppercase text-[10px] tracking-[0.25em] text-white/50";

type SetPasswordFormProps = {
  token: string;
  email: string | null;
};

const SetPasswordForm = ({ token, email }: SetPasswordFormProps) => {
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
    const res = await fetch("/api/miembros/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    if (!res.ok) {
      setLoading(false);
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (data?.error === "weak_password" && data.message) {
        setError(data.message);
      } else if (data?.error === "invalid_token") {
        setError(
          "Este enlace ya no es válido. Pide uno nuevo desde “Olvidé mi contraseña”."
        );
      } else {
        setError("Algo salió mal. Intenta de nuevo.");
      }
      return;
    }

    const data = (await res.json().catch(() => null)) as {
      email?: string | null;
    } | null;
    const loginEmail = data?.email ?? email;

    if (loginEmail) {
      const result = await signIn("credentials", {
        email: loginEmail,
        password,
        redirect: false,
        callbackUrl: "/miembros",
      });
      if (!result?.error) {
        window.location.href = result?.url ?? "/miembros";
        return;
      }
    }

    window.location.href = "/acceso";
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {email ? (
        <p className="font-[font1] text-sm text-white/60">
          Cuenta para <span className="text-white">{email}</span>
        </p>
      ) : null}

      <label className="block">
        <span className={labelClass}>Nueva contraseña</span>
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
        <span className={labelClass}>Confirma tu contraseña</span>
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
        <p className="font-[font1] text-sm text-blush" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-full bg-linen py-3.5 font-[font2] uppercase text-xs tracking-[0.25em] text-black transition-colors hover:bg-white disabled:opacity-60"
      >
        {loading ? "Guardando…" : "Crear contraseña y entrar"}
      </button>
    </form>
  );
};

export default SetPasswordForm;
