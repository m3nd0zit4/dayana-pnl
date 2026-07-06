"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
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
  team: initialTeam,
  currentId,
  canManage,
  preview,
}: Props) => {
  const [team, setTeam] = useState<Member[]>(initialTeam);
  const [modalOpen, setModalOpen] = useState(false);

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
            <Button size="sm" onClick={() => setModalOpen(true)}>
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
                  <div className="text-sm font-semibold">{u.displayName}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {u.email}
                  </div>
                </div>
                <div className="font-[font2] text-[10px] tracking-widest text-primary uppercase">
                  {u.role}
                  {currentId === u.id ? " · tú" : ""}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <StaffFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={(member) => setTeam((prev) => [...prev, member])}
      />
    </CrmPageShell>
  );
};

export default TeamPageClient;
