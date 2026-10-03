"use client";

import { Copy, ExternalLink, Flag, Link2, MoreHorizontal, RotateCcw, Send, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { useCrm } from "../CrmProvider";
import { CrmPublicLink } from "../ui";
import type { EditionStatus } from "./status";
import {
  useEditionActions,
  type EditionActionTarget,
  type EditionActionsConfig,
  type EditionOther,
} from "./useEditionActions";

type Props = {
  config: EditionActionsConfig;
  target: EditionActionTarget & { status: EditionStatus };
  publicLink: { href: string; label?: string; copy?: boolean; disabledReason?: string };
  /** La publicada ahora, si es otra: se nombra al publicar esta. */
  openOther: EditionOther;
  canDuplicate: boolean;
  /** Borrar: solo sin inscritas y sin publicar. Si no, el motivo. */
  deleteBlockedReason?: string | null;
  /** Adónde ir tras borrar. */
  afterDeleteHref: string;
  /**
   * Lo que falta para publicar y se sabe ya (p. ej. el precio en pesos de un
   * taller): «Publicar» lo dice en vez de llamar a la API.
   */
  publishBlockedReason?: string | null;
};

type Step = { key: string; label: string; icon: LucideIcon; run: () => void; primary?: boolean };

/**
 * Las acciones de la cabecera de una edición: verla en la web, duplicarla, el
 * paso que le toca según su estado (publicar, cerrar inscripciones, terminar,
 * reabrir) y borrarla. Ninguna crea nada, así que van como secundarias
 * (contrato R2). Borrar vive solo aquí, dentro de «⋯».
 *
 * En el teléfono se queda a la vista el paso principal y el resto entra en
 * «⋯»: siete botones no caben en 390 px.
 */
const EditionDetailActions = ({
  config,
  target,
  publicLink,
  openOther,
  canDuplicate,
  deleteBlockedReason,
  afterDeleteHref,
  publishBlockedReason,
}: Props) => {
  const router = useRouter();
  const { canWrite, toast } = useCrm();
  const actions = useEditionActions(config);
  const busy = actions.busyId === target.id;

  const publish = () => {
    if (publishBlockedReason) return void toast(publishBlockedReason, "error");
    actions.publish(target, openOther);
  };

  const steps: Step[] = [];
  if (canWrite) {
    if (target.status === "OPEN") {
      steps.push({ key: "unpublish", label: "Cerrar inscripciones", icon: Square, run: () => actions.unpublish(target) });
      steps.push({ key: "end", label: "Terminar", icon: Flag, run: () => actions.end(target) });
    }
    if (target.status === "CLOSED") {
      steps.push({ key: "end", label: "Terminar", icon: Flag, run: () => actions.end(target) });
    }
    if (target.status === "COMPLETED") {
      steps.push({ key: "reopen", label: "Reabrir", icon: RotateCcw, run: () => actions.reopen(target) });
    }
    if (target.status === "DRAFT" || target.status === "CLOSED") {
      steps.push({
        key: "publish",
        label: target.status === "CLOSED" ? "Publicar otra vez" : "Publicar",
        icon: Send,
        run: publish,
        primary: true,
      });
    }
  }
  // En el teléfono: el publicar si lo hay; si no, el primer paso.
  const mobileMain = steps.find((s) => s.primary) ?? steps[0] ?? null;

  const copyLink = async () => {
    try {
      const url = publicLink.href.startsWith("http") ? publicLink.href : `${window.location.origin}${publicLink.href}`;
      await navigator.clipboard.writeText(url);
      toast("Enlace copiado");
    } catch {
      toast({ message: "No se pudo copiar el enlace", variant: "error" });
    }
  };

  const linkDisabled = Boolean(publicLink.disabledReason);

  return (
    <>
      {/* Escritorio: todo a la vista. */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        <CrmPublicLink
          href={publicLink.href}
          label={publicLink.label ?? "Ver en web"}
          copy={publicLink.copy}
          disabledReason={publicLink.disabledReason}
        />
        {canWrite && canDuplicate ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => actions.duplicate(target)}>
            <Copy aria-hidden />
            Duplicar
          </Button>
        ) : null}
        {steps.map((s) => (
          <Button
            key={s.key}
            type="button"
            variant={s.primary ? "default" : "outline"}
            size="sm"
            disabled={busy}
            onClick={s.run}
            title={s.primary && publishBlockedReason ? publishBlockedReason : undefined}
          >
            <s.icon aria-hidden />
            {s.label}
          </Button>
        ))}
      </div>

      {/* Teléfono: el paso principal y «⋯». */}
      {mobileMain ? (
        <Button
          type="button"
          variant={mobileMain.primary ? "default" : "outline"}
          size="sm"
          disabled={busy}
          onClick={mobileMain.run}
          className="sm:hidden"
        >
          <mobileMain.icon aria-hidden />
          {mobileMain.label}
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Más acciones"
              title="Más acciones"
              className={canWrite ? undefined : "sm:hidden"}
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <div className="sm:hidden">
            <DropdownMenuItem
              disabled={linkDisabled}
              onClick={() => window.open(publicLink.href, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink aria-hidden />
              {publicLink.label ?? "Ver en web"}
            </DropdownMenuItem>
            {publicLink.copy && !linkDisabled ? (
              <DropdownMenuItem onClick={() => void copyLink()}>
                <Link2 aria-hidden />
                Copiar enlace
              </DropdownMenuItem>
            ) : null}
            {linkDisabled ? (
              <p className="px-1.5 pb-1 text-[11px] leading-snug text-muted-foreground">{publicLink.disabledReason}</p>
            ) : null}
            {canWrite && canDuplicate ? (
              <DropdownMenuItem disabled={busy} onClick={() => actions.duplicate(target)}>
                <Copy aria-hidden />
                Duplicar
              </DropdownMenuItem>
            ) : null}
            {steps
              .filter((s) => s !== mobileMain)
              .map((s) => (
                <DropdownMenuItem key={s.key} disabled={busy} onClick={s.run}>
                  <s.icon aria-hidden />
                  {s.label}
                </DropdownMenuItem>
              ))}
          </div>
          {canWrite ? (
            <>
              <DropdownMenuSeparator className="sm:hidden" />
              <DropdownMenuItem
                variant="destructive"
                disabled={busy || Boolean(deleteBlockedReason)}
                onClick={() => actions.remove(target, () => router.push(afterDeleteHref))}
              >
                <Trash2 aria-hidden />
                Eliminar
              </DropdownMenuItem>
              {deleteBlockedReason ? (
                <p className="pr-1.5 pb-1 pl-7 text-[11px] leading-snug text-muted-foreground">{deleteBlockedReason}</p>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

export default EditionDetailActions;
