"use client";

import { useEffect, useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";

type Props = {
  open: boolean;
  contactName: string;
  /** What the staff member must retype: the real phone, or (for
   *  Google/email-signup leads with no captured number) the full name. */
  confirmTarget: { kind: "phone" | "name"; value: string };
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (confirm: string) => void | Promise<void>;
};

const DeleteContactDialog = ({
  open,
  contactName,
  confirmTarget,
  busy,
  error,
  onClose,
  onConfirm,
}: Props) => {
  const inputId = useId();
  const [confirm, setConfirm] = useState("");
  const isPhone = confirmTarget.kind === "phone";

  useEffect(() => {
    if (!open) {
      setConfirm("");
    }
  }, [open]);

  const canSubmit = confirm.trim().length > 0 && !busy;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar contacto</AlertDialogTitle>
          <AlertDialogDescription>
            Se borrará <span className="font-medium text-foreground">{contactName}</span>{" "}
            y todo lo relacionado: servicios, pagos, cuaderno clínico, mensajes y
            notificaciones. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm">
          Escribe {isPhone ? "el teléfono" : "el nombre completo"}{" "}
          <span className="font-mono font-semibold tabular-nums">
            {confirmTarget.value}
          </span>{" "}
          para confirmar.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>{isPhone ? "Teléfono" : "Nombre completo"}</Label>
          <Input
            id={inputId}
            type={isPhone ? "tel" : "text"}
            autoComplete="off"
            placeholder={confirmTarget.value}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!canSubmit}
            onClick={() => void onConfirm(confirm)}
          >
            {busy ? "Eliminando…" : "Eliminar contacto"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteContactDialog;
