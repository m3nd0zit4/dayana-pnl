"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import { CrmRowActions, CrmRowDelete } from "@/app/components/admin/crm/ui";

export type ArchivedEditionRow = {
  id: string;
  headline: string;
  startsAtIso: string | null;
  startsAtHasTime: boolean;
  archivedAtIso: string | null;
  registrations: number;
};

type Props = {
  editions: ArchivedEditionRow[];
  /** Borrar es irreversible y se lleva la lista: solo OWNER. */
  canDelete?: boolean;
};

const editionDate = (row: ArchivedEditionRow): string => {
  if (!row.startsAtIso) return "sin fecha";
  const d = new Date(row.startsAtIso);
  return d.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

/**
 * Historial de ediciones pasadas.
 *
 * Solo vive en el CRM: a diferencia de los talleres, una edicion archivada no
 * aparece en ninguna pagina publica ni conserva URL. Es memoria interna de
 * quien asistio a que, y se puede borrar cuando deje de hacer falta.
 */
const WebinarEditionsPanel = ({ editions, canDelete = false }: Props) => {
  const router = useRouter();
  const { toast, confirm } = useCrm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const remove = (row: ArchivedEditionRow) => {
    confirm({
      title: "Eliminar edición del historial",
      message: `Se borrará la edición del ${editionDate(row)} y sus ${row.registrations.toLocaleString("es-CO")} registradas. No se puede deshacer.`,
      confirmLabel: "Eliminar",
      destructive: true,
      onConfirm: async () => {
        setBusyId(row.id);
        try {
          const res = await fetch(`/api/admin/webinar/editions/${row.id}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            toast(
              res.status === 403
                ? "Solo la dueña de la cuenta puede borrar el historial."
                : "No se pudo eliminar."
            );
            return;
          }
          toast("Edición eliminada");
          router.refresh();
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  if (editions.length === 0) return null;

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base uppercase tracking-wide">
          Ediciones anteriores
        </CardTitle>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {editions.length}
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Historial interno. No se publica en ninguna página; sirve para saber
          quién asistió a cada edición.
        </p>
        <ul className="divide-y divide-border">
          {editions.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {editionDate(row)}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {row.registrations.toLocaleString("es-CO")} registradas
                  {row.archivedAtIso
                    ? ` · archivada el ${new Date(row.archivedAtIso).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}`
                    : ""}
                </p>
              </div>
              {canDelete ? (
                <CrmRowActions>
                  <CrmRowDelete
                    onClick={() => remove(row)}
                    disabled={busyId === row.id}
                  />
                </CrmRowActions>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

export default WebinarEditionsPanel;
