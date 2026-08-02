"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import CrmModal from "./CrmModal";
import SearchableSelect from "./SearchableSelect";

export type CreatedStaffMember = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
};

type EditingStaffMember = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (member: CreatedStaffMember) => void;
  /** When set, the modal edits this member (role/name/active) instead of
   * creating a new one. Email stays read-only — it's the login identifier. */
  editing?: EditingStaffMember | null;
  /** Disallow changing your own role/active state from this modal — avoids
   * an OWNER accidentally locking themselves out. */
  isSelf?: boolean;
};

const ROLES = [
  { value: "OPERATOR", label: "Operador" },
  { value: "READONLY", label: "Solo lectura" },
  { value: "OWNER", label: "Owner" },
  { value: "DEVELOPER", label: "Developer" },
];

const StaffFormModal = ({ open, onClose, onSaved, editing, isSelf }: Props) => {
  const isEditing = Boolean(editing);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("OPERATOR");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setDisplayName(editing.displayName);
      setEmail(editing.email);
      setRole(editing.role);
      setIsActive(editing.isActive);
      setPassword("");
    } else {
      setDisplayName("");
      setEmail("");
      setPassword("");
      setRole("OPERATOR");
      setIsActive(true);
    }
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/team", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        isEditing
          ? { id: editing!.id, displayName, role, isActive }
          : { displayName, email, password, role }
      ),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const messages: Record<string, string> = {
        forbidden: "No tienes permiso para gestionar el equipo.",
        last_owner: "No puedes quitar al último OWNER activo.",
        not_found: "Usuario no encontrado.",
      };
      setError(
        messages[data.error ?? ""] ??
          (isEditing ? "No se pudo actualizar el usuario." : "No se pudo crear el usuario.")
      );
      return;
    }
    const data = (await res.json().catch(() => ({}))) as {
      staff?: CreatedStaffMember;
    };
    if (data.staff) onSaved(data.staff);
    onClose();
  };

  return (
    <CrmModal
      title={isEditing ? "Editar miembro" : "Añadir miembro del equipo"}
      open={open}
      onClose={onClose}
    >
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
            disabled={isEditing}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {!isEditing && (
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
        )}
        <SearchableSelect
          id="s-role"
          label="Rol"
          value={role}
          options={ROLES}
          onChange={setRole}
          searchMinOptions={99}
          disabled={isSelf}
        />
        {isEditing && (
          <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
            <div>
              <Label htmlFor="s-active">Activo</Label>
              <p className="text-xs text-muted-foreground">
                Un usuario inactivo pierde acceso al CRM de inmediato.
              </p>
            </div>
            <Switch
              id="s-active"
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={isSelf}
            />
          </div>
        )}
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
            {loading
              ? isEditing
                ? "Guardando…"
                : "Creando…"
              : isEditing
                ? "Guardar cambios"
                : "Crear usuario"}
          </Button>
        </div>
      </form>
    </CrmModal>
  );
};

export default StaffFormModal;
