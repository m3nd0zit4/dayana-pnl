"use client";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";
import { CrmFormActions } from "../ui";

/**
 * La barra de guardar de un editor de página. Pegada abajo mientras se
 * desplaza —en el teléfono, justo encima de la barra inferior y de «Pregunta»—,
 * así «Guardar» está siempre a mano y nunca hay que bajar diez tarjetas para
 * encontrarlo. Dice si hay cambios sin guardar.
 */
const EditionSaveBar = ({
  dirty,
  saving,
  disabled,
  onSave,
  onDiscard,
  label = "Guardar cambios",
}: {
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  label?: string;
}) => (
  <div
    // El contenedor que desplaza ya reserva abajo el sitio de la barra
    // inferior y de «Pregunta» (su padding): la barra se pega justo encima.
    className="sticky bottom-3 z-20 -mx-1"
  >
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-md backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <p className="flex min-w-0 flex-1 items-center gap-2 text-xs" role="status" aria-live="polite">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", dirty ? "bg-warning" : "bg-success")}
        />
        <span className={cn("truncate", dirty ? "font-medium text-foreground" : "text-muted-foreground")}>
          {dirty ? "Cambios sin guardar" : "Todo guardado"}
        </span>
      </p>
      <CrmFormActions className="mt-0 shrink-0 flex-row items-center">
        {/* En el teléfono, 40 px de alto (con el pulgar); en escritorio, el `sm` de siempre. */}
        {dirty && onDiscard ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onDiscard}
            className="h-10 px-3 sm:h-7 sm:px-2.5"
          >
            Descartar
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={saving || disabled || !dirty}
          onClick={onSave}
          className="h-10 px-4 sm:h-7 sm:px-2.5"
        >
          {saving ? (
            "Guardando…"
          ) : (
            <>
              <span className="sm:hidden">Guardar</span>
              <span className="hidden sm:inline">{label}</span>
            </>
          )}
        </Button>
      </CrmFormActions>
    </div>
  </div>
);

export default EditionSaveBar;
