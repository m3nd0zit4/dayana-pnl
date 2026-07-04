"use client";

import { useState } from "react";
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
        <div>
          <label className="crm-label" htmlFor="s-name">
            Nombre visible
          </label>
          <input
            id="s-name"
            className="crm-input"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <label className="crm-label" htmlFor="s-email">
            Email
          </label>
          <input
            id="s-email"
            type="email"
            className="crm-input"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="crm-label" htmlFor="s-pass">
            Contraseña
          </label>
          <input
            id="s-pass"
            type="password"
            className="crm-input"
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
          <p className="text-sm text-[var(--crm-danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="crm-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="crm-btn-primary" disabled={loading}>
            {loading ? "Creando…" : "Crear usuario"}
          </button>
        </div>
      </form>
    </CrmModal>
  );
};

export default StaffFormModal;
