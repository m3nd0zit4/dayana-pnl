"use client";

import { useState } from "react";

const inputClass =
  "w-full rounded-lg border border-linen/20 bg-black/40 px-4 py-3 font-[font1] text-sm text-white placeholder-white/30 transition-colors focus:border-linen/50 focus:outline-none";

const labelClass =
  "mb-2 block font-[font2] uppercase text-[10px] tracking-[0.25em] text-white/50";

const ChangePasswordForm = ({ hasPassword }: { hasPassword: boolean }) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (newPassword !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/miembros/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        hasPassword ? { currentPassword, newPassword } : { newPassword }
      ),
    });
    setLoading(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (data?.error === "weak_password" && data.message) {
        setError(data.message);
      } else if (data?.error === "wrong_password") {
        setError("Tu contraseña actual no es correcta.");
      } else {
        setError("Algo salió mal. Intenta de nuevo.");
      }
      return;
    }

    setDone(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {hasPassword && (
        <label className="block">
          <span className={labelClass}>Contraseña actual</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
          />
        </label>
      )}

      <label className="block">
        <span className={labelClass}>
          {hasPassword ? "Nueva contraseña" : "Crea una contraseña"}
        </span>
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
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
        <p className="font-[font1] text-sm text-blush" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="font-[font1] text-sm text-linen" role="status">
          Contraseña actualizada.
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-full border border-linen/30 px-7 py-3 font-[font2] uppercase text-xs tracking-[0.25em] text-white/85 transition-colors hover:bg-linen/5 hover:text-white disabled:opacity-60"
      >
        {loading ? "Guardando…" : hasPassword ? "Cambiar contraseña" : "Crear contraseña"}
      </button>
    </form>
  );
};

export default ChangePasswordForm;
