"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import CrmModal from "./CrmModal";
import SearchableSelect from "./SearchableSelect";

export type CreatedStaffMember = {
  id: string;
  displayName: string;
  email: string;
  role: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (member: CreatedStaffMember) => void;
};

const ROLES = [
  { value: "OPERATOR", label: "Operador" },
  { value: "READONLY", label: "Solo lectura" },
  { value: "OWNER", label: "Owner" },
  { value: "DEVELOPER", label: "Developer" },
];

const StaffFormModal = ({ open, onClose, onSaved }: Props) => {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("OPERATOR");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName, email, password, role }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        data.error === "forbidden"
          ? "No tienes permiso para añadir equipo."
          : "No se pudo crear el usuario."
      );
      return;
    }
    const data = (await res.json().catch(() => ({}))) as {
      staff?: CreatedStaffMember;
    };
    setDisplayName("");
    setEmail("");
    setPassword("");
    if (data.staff) onSaved(data.staff);
    onClose();
  };

  return (
    <CrmModal title="Añadir miembro del equipo" open={open} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="s-name">Nombre visible</Label>
          <Input
            id="s-name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-email">Email</Label>
          <Input
            id="s-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-pass">Contraseña</Label>
          <Input
            id="s-pass"
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <SearchableSelect
          id="s-role"
          label="Rol"
          value={role}
          options={ROLES}
          onChange={setRole}
          searchMinOptions={99}
        />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Creando…" : "Crear usuario"}
          </Button>
        </div>
      </form>
    </CrmModal>
  );
};

export default StaffFormModal;
