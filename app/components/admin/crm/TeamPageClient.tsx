"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import CrmPageShell from "./CrmPageShell";
import StaffFormModal from "./StaffFormModal";

type Member = {
  id: string;
  displayName: string;
  email: string;
  role: string;
};

type Props = {
  team: Member[];
  currentId?: string;
  canManage: boolean;
  preview: boolean;
};

const TeamPageClient = ({
  team,
  currentId,
  canManage,
  preview,
}: Props) => {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="crm-section-title text-xl">Equipo</h1>
            <p className="crm-section-subtitle mt-1 max-w-xl">
              Usuarios con acceso al CRM. Solo OWNER puede invitar a más personas.
            </p>
          </div>
          {canManage && !preview && (
            <button
              type="button"
              className="crm-btn-primary"
              onClick={() => setModalOpen(true)}
            >
              <Plus className="size-4" />
              Añadir usuario
            </button>
          )}
        </div>

        <div className="crm-surface-card overflow-hidden">
          <ul className="divide-y divide-[var(--crm-border)]">
            {team.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-4 p-4 crm-table-row"
              >
                <div>
                  <div className="text-sm font-semibold">{u.displayName}</div>
                  <div className="mt-0.5 text-xs text-[var(--crm-muted)]">
                    {u.email}
                  </div>
                </div>
                <div className="crm-font-display text-[10px] tracking-widest text-[var(--crm-accent)]">
                  {u.role}
                  {currentId === u.id ? " · tú" : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <StaffFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => router.refresh()}
      />
    </CrmPageShell>
  );
};

export default TeamPageClient;
