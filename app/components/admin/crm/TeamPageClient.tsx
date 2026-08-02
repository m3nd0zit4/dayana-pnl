"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import CrmPageShell from "./CrmPageShell";
import StaffFormModal, { type CreatedStaffMember } from "./StaffFormModal";

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
    setTeam((prev) => {
      const exists = prev.some((u) => u.id === member.id);
      return exists
        ? prev.map((u) => (u.id === member.id ? { ...u, ...member } : u))
        : [...prev, member];
    });
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Equipo</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Usuarios con acceso al CRM. Solo OWNER puede invitar a más personas.
            </p>
          </div>
          {canManage && !preview && (
            <Button size="sm" onClick={openCreate}>
              <Plus />
              <span className="hidden sm:inline">Añadir usuario</span>
            </Button>
          )}
        </div>

        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
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
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar"
                      title="Editar"
                      onClick={() => openEdit(u)}
                    >
                      <Pencil />
                    </Button>
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
