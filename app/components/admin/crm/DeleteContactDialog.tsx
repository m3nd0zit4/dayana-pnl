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
  phoneE164: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (phoneConfirm: string) => void | Promise<void>;
};

const DeleteContactDialog = ({
  open,
  contactName,
  phoneE164,
  busy,
  error,
  onClose,
  onConfirm,
}: Props) => {
  const inputId = useId();
  const [phoneConfirm, setPhoneConfirm] = useState("");

  useEffect(() => {
    if (!open) {
      setPhoneConfirm("");
    }
  }, [open]);

  const canSubmit = phoneConfirm.trim().length > 0 && !busy;

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
          Escribe el teléfono{" "}
          <span className="font-mono font-semibold tabular-nums">{phoneE164}</span>{" "}
          para confirmar.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>Teléfono</Label>
          <Input
            id={inputId}
            type="tel"
            autoComplete="off"
            placeholder={phoneE164}
            value={phoneConfirm}
            onChange={(e) => setPhoneConfirm(e.target.value)}
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
            onClick={() => void onConfirm(phoneConfirm)}
          >
            {busy ? "Eliminando…" : "Eliminar contacto"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteContactDialog;
