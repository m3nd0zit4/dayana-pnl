"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/**
 * Confirmación de acciones irreversibles (regla R7).
 *
 * Antes el botón decía siempre «Confirmar», que es la etiqueta más débil
 * posible: obliga a releer el título para saber qué vas a hacer. Ahora cada
 * llamada pasa el verbo — «Eliminar», «Revocar», «Archivar» — y el diálogo lo
 * pinta con relleno destructivo cuando toca.
 */

type Props = {
  open: boolean;
  title: string;
  message: string;
  /** Verbo concreto de la acción. «Confirmar» solo si de verdad no hay uno. */
  confirmLabel?: string;
  /** Tiñe el botón de confirmar. Para todo lo que borra o revoca. */
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

const CrmConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  destructive = false,
  onClose,
  onConfirm,
}: Props) => (
  <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{message}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter data-crm-form-actions="">
        <AlertDialogCancel onClick={onClose}>Cancelar</AlertDialogCancel>
        <AlertDialogAction
          onClick={() => void onConfirm()}
          className={cn(
            destructive &&
              "bg-destructive/10 text-destructive hover:bg-destructive/20",
          )}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default CrmConfirmDialog;
