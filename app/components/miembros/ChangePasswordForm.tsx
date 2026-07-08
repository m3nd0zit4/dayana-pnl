"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";

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
        <div className="space-y-1.5">
          <Label>Contraseña actual</Label>
          <Input
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{hasPassword ? "Nueva contraseña" : "Crea una contraseña"}</Label>
        <Input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Mínimo 12 caracteres"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Confírmala</Label>
        <Input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-green-700" role="status">
          Contraseña actualizada.
        </p>
      )}

      <Button type="submit" variant="outline" disabled={loading}>
        {loading
          ? "Guardando…"
          : hasPassword
            ? "Cambiar contraseña"
            : "Crear contraseña"}
      </Button>
    </form>
  );
};

export default ChangePasswordForm;
