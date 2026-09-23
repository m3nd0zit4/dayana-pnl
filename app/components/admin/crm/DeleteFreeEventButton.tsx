"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/app/components/ui/button";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";

/**
 * Borra un evento archivado y su lista de inscritas. Irreversible: pide
 * confirmación y solo lo ve la dueña (la ruta lo vuelve a exigir).
 */
const DeleteFreeEventButton = ({
  id,
  label,
  registrations,
}: {
  id: string;
  label: string;
  registrations: number;
}) => {
  const router = useRouter();
  const { toast, confirm } = useCrm();
  const [busy, setBusy] = useState(false);

  const remove = () =>
    confirm({
      title: "Eliminar evento del historial",
      message: `Se borrará el evento del ${label} y sus ${registrations.toLocaleString("es-CO")} inscritas. No se puede deshacer.`,
      confirmLabel: "Eliminar",
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/admin/webinar/editions/${id}`, {
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
          toast("Evento eliminado");
          router.push("/admin/eventos/historial");
          router.refresh();
        } finally {
          setBusy(false);
        }
      },
    });

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-destructive"
      disabled={busy}
      onClick={remove}
    >
      <Trash2 className="size-4" aria-hidden />
      Eliminar
    </Button>
  );
};

export default DeleteFreeEventButton;
