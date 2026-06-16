"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

const AdminSignInForm = () => {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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
        "No pudimos iniciar sesión. Revisa email y contraseña, o ejecuta el seed del staff."
      );
      return;
    }

    if (result?.url) {
      window.location.href = result.url;
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-6 text-center font-[font2] uppercase leading-none text-[var(--crm-foreground)]">
          <span className="block text-base tracking-[0.14em]">Dayana Beltr&aacute;n</span>
          <span className="mt-1.5 block text-[10px] tracking-[0.5em] opacity-70">
            PNL
          </span>
        </div>
        <h1 className="sr-only">Acceso CRM</h1>
        <p className="mt-2 text-sm text-[var(--crm-muted)] leading-relaxed">
          Acceso interno para contactos, terapias, talleres y pagos. Los clientes
          siguen por WhatsApp.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="crm-surface-card space-y-5 p-6 sm:p-8"
      >
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--crm-muted)]">
            Email
          </span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            className="crm-input"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--crm-muted)]">
            Contraseña
          </span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="crm-input"
          />
        </label>

        {error && (
          <p className="text-sm text-[var(--crm-danger)]" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="crm-btn-primary w-full py-3"
        >
          {loading ? "Entrando…" : "Entrar al panel"}
        </button>

        <p className="text-center text-[11px] text-[var(--crm-muted)]">
          La sesión permanece activa hasta 30 días en este dispositivo.
        </p>
      </form>
    </div>
  );
};

export default AdminSignInForm;
