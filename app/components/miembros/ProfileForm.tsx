"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import SearchableSelect from "@/app/components/admin/crm/SearchableSelect";
import AppearanceThemeToggle from "@/app/components/shared/settings/AppearanceThemeToggle";
import { LOCALE_OPTIONS, WORK_DESCRIPTION_OPTIONS } from "@/lib/profile-options";

type ProfileFormProps = {
  initialFirstName: string;
  initialLastName: string;
  /** E164 (+573001234567) or empty when the contact only has a placeholder phone. */
  initialPhone: string;
  initialWorkDescription: string;
  initialPreferredLocale: string;
};

const ProfileForm = ({
  initialFirstName,
  initialLastName,
  initialPhone,
  initialWorkDescription,
  initialPreferredLocale,
}: ProfileFormProps) => {
  const router = useRouter();
  const { update: updateSession } = useSession();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [phone, setPhone] = useState(initialPhone);
  const [workDescription, setWorkDescription] = useState(initialWorkDescription);
  const [preferredLocale, setPreferredLocale] = useState(initialPreferredLocale);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    setLoading(true);

    const res = await fetch("/api/miembros/perfil", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        phone: phone.trim() || null,
        workDescription: workDescription || null,
        preferredLocale,
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (data?.error === "invalid_phone") {
        setError(
          "Número no válido. Usa el formato internacional, ej. +57 300 123 4567."
        );
      } else if (data?.error === "phone_taken") {
        setError("Ese número ya está registrado con otra cuenta.");
      } else {
        setError("No se pudo guardar. Intenta de nuevo.");
      }
      return;
    }

    setDone(true);
    // Refresh the JWT's display name (header greeting) + re-render the page.
    await updateSession().catch(() => undefined);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pf-first">Nombre</Label>
          <Input
            id="pf-first"
            required
            maxLength={80}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-last">Apellido</Label>
          <Input
            id="pf-last"
            maxLength={80}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pf-phone">Teléfono (WhatsApp)</Label>
        <Input
          id="pf-phone"
          type="tel"
          maxLength={24}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+57 300 123 4567"
        />
        <p className="text-xs text-muted-foreground">
          Formato internacional con el signo +. Déjalo vacío para no cambiarlo.
        </p>
      </div>

      <SearchableSelect
        id="pf-work"
        label="¿Qué te describe mejor?"
        value={workDescription}
        options={WORK_DESCRIPTION_OPTIONS}
        onChange={setWorkDescription}
        allowEmpty
        emptyLabel="Prefiero no decir"
        searchMinOptions={99}
      />

      <SearchableSelect
        id="pf-locale"
        label="Idioma"
        value={preferredLocale}
        options={LOCALE_OPTIONS}
        onChange={setPreferredLocale}
        searchMinOptions={99}
      />

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

export default ProfileForm;
