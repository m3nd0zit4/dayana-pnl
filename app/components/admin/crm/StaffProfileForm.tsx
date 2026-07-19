"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import AppearanceThemeToggle from "@/app/components/shared/settings/AppearanceThemeToggle";

type StaffProfileFormProps = {
  initialDisplayName: string;
};

const StaffProfileForm = ({ initialDisplayName }: StaffProfileFormProps) => {
  const router = useRouter();
  const { update: updateSession } = useSession();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    setLoading(true);

    const res = await fetch("/api/admin/staff/me/perfil", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: displayName.trim() }),
    });
    setLoading(false);

    if (!res.ok) {
      setError("No se pudo guardar. Intenta de nuevo.");
      return;
    }

    setDone(true);
    await updateSession().catch(() => undefined);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="spf-name">Nombre</Label>
        <Input
          id="spf-name"
          required
          maxLength={120}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Apariencia</Label>
        <AppearanceThemeToggle />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-emerald-600" role="status">
          Datos guardados.
        </p>
      )}

      <Button type="submit" disabled={loading}>
        {loading ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
};

export default StaffProfileForm;
