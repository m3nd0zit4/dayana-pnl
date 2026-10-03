"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import CrmNewButton from "../CrmNewButton";
import CrmPageHeader from "../CrmPageHeader";
import CrmPageShell from "../CrmPageShell";
import CrmSegmentedControl from "../CrmSegmentedControl";
import { CrmDataList, CrmDataListRow, CrmEmptyState } from "../ui";
import EditionStatusBadge from "./EditionStatusBadge";
import type { EditionStatus } from "./status";

export type EditionsView = "proximos" | "pasados";

/** Lo que pinta una fila: el título, su estado y lo que va debajo. */
export type EditionRowView = {
  id: string;
  href: string;
  title: string;
  status: EditionStatus;
  /** Líneas bajo el título (fecha, inscritas, recordatorios…). */
  details: ReactNode;
  /** Como mucho tres, por estado (contrato R6). */
  actions?: ReactNode;
};

type Props = {
  title: string;
  description: ReactNode;
  secondaryActions?: ReactNode;
  /** «Nuevo evento», «Nuevo taller». Sin ella no se pinta el botón. */
  newLabel?: string;
  onNew?: () => void;
  /** `/admin/eventos`, `/admin/workshops`: la vista va en `?vista=`. */
  basePath: string;
  /** «Qué eventos», «Qué talleres». */
  viewsAriaLabel: string;
  initialView: EditionsView;
  upcoming: EditionRowView[];
  past: EditionRowView[];
  icon: LucideIcon;
  empty: { upcoming: string; upcomingDescription: string; past: string; pastDescription: string };
  /** Lo que va debajo de la lista (el modal de «Nuevo …»). */
  children?: ReactNode;
};

/**
 * La lista de ediciones, igual en eventos y en talleres: «Próximos» (la
 * publicada, las cerradas que aún no pasan y los borradores) y «Pasados». La
 * fila entera abre el detalle; a la derecha, las acciones que tocan según el
 * estado. El estado se ve también en el teléfono.
 */
const EditionsListShell = ({
  title,
  description,
  secondaryActions,
  newLabel,
  onNew,
  basePath,
  viewsAriaLabel,
  initialView,
  upcoming,
  past,
  icon,
  empty,
  children,
}: Props) => {
  const router = useRouter();
  const [view, setView] = useState<EditionsView>(initialView);
  const shown = view === "pasados" ? past : upcoming;

  const changeView = (next: EditionsView) => {
    setView(next);
    router.replace(next === "pasados" ? `${basePath}?vista=pasados` : basePath, { scroll: false });
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title={title}
        description={description}
        secondaryActions={secondaryActions}
        action={newLabel && onNew ? <CrmNewButton label={newLabel} onClick={onNew} /> : undefined}
        trailing={
          <CrmSegmentedControl
            aria-label={viewsAriaLabel}
            value={view}
            onChange={changeView}
            segments={[
              { id: "proximos", label: "Próximos", count: upcoming.length },
              { id: "pasados", label: "Pasados", count: past.length },
            ]}
          />
        }
      />

      {shown.length === 0 ? (
        <CrmEmptyState
          icon={icon}
          title={view === "pasados" ? empty.past : empty.upcoming}
          description={view === "pasados" ? empty.pastDescription : empty.upcomingDescription}
        />
      ) : (
        <CrmDataList>
          {shown.map((row) => (
            <CrmDataListRow key={row.id} actions={row.actions}>
              <Link href={row.href} className="block min-w-0 flex-1 py-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 font-medium leading-snug [overflow-wrap:anywhere]">{row.title}</span>
                  <EditionStatusBadge status={row.status} />
                </span>
                {row.details}
              </Link>
            </CrmDataListRow>
          ))}
        </CrmDataList>
      )}
      {children}
    </CrmPageShell>
  );
};

export default EditionsListShell;
