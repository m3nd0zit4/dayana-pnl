"use client";

import { Users } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent } from "@/app/components/ui/card";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";
import StaffFormModal, { type CreatedStaffMember } from "./StaffFormModal";
import { CrmEmptyState, CrmRowActions, CrmRowEdit } from "./ui";

type Member = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
};

type Props = {
  team: Member[];
  currentId?: string;
  canManage: boolean;
  preview: boolean;
};

const TeamPageClient = ({
  team: initialTeam,
  currentId,
  canManage,
  preview,
}: Props) => {
  const { toast } = useCrm();
  const [team, setTeam] = useState<Member[]>(initialTeam);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (member: Member) => {
    setEditing(member);
    setModalOpen(true);
  };

  const handleSaved = (member: CreatedStaffMember) => {
    let existed = false;
    setTeam((prev) => {
      existed = prev.some((u) => u.id === member.id);
      return existed
        ? prev.map((u) => (u.id === member.id ? { ...u, ...member } : u))
        : [...prev, member];
    });
    // Esta pantalla no daba ninguna señal al guardar: la fila cambiaba y ya.
    toast(existed ? "Usuario actualizado" : "Usuario añadido");
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Equipo"
        description="Usuarios con acceso al CRM. Solo OWNER puede invitar a más personas."
        action={
          canManage && !preview ? (
            <CrmNewButton label="Añadir usuario" onClick={openCreate} />
          ) : undefined
        }
      />

      <div className="space-y-6">
        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
            {team.length === 0 && (
              <CrmEmptyState
                icon={Users}
                title="Sin usuarios"
                description="Añade a alguien para darle acceso al panel."
              />
            )}
            {team.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/50"
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {u.displayName}
                    {!u.isActive && <Badge variant="destructive">Inactivo</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {u.email}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="font-[font2] text-[10px] tracking-widest text-primary uppercase">
                    {u.role}
                    {currentId === u.id ? " · tú" : ""}
                  </div>
                  {canManage && !preview && (
                    <CrmRowActions>
                      <CrmRowEdit onClick={() => openEdit(u)} />
                    </CrmRowActions>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <StaffFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        editing={editing}
        isSelf={editing?.id === currentId}
      />
    </CrmPageShell>
  );
};

export default TeamPageClient;
