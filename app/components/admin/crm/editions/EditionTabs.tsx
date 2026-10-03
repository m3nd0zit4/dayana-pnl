"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  FileText,
  History,
  MessageCircle,
  Paperclip,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import CrmSegmentedControl from "../CrmSegmentedControl";
import { useCrm } from "../CrmProvider";
import { guardedNavigate } from "./dirty-guard";
import type { EditionTabSpec } from "./status";

/** Iconos por pestaña: los componentes no cruzan del servidor al cliente. */
const ICONS: Record<string, LucideIcon> = {
  pagina: FileText,
  precio: Tag,
  inscritas: Users,
  documentos: Paperclip,
  whatsapp: MessageCircle,
  historia: History,
};

/**
 * Las pestañas de una edición (evento o taller). Cada una es una URL
 * (`?tab=`): se carga en el servidor solo lo de la pestaña abierta, y un aviso
 * puede llevar directo a «Inscritas» o a «Historia». En el teléfono, una
 * rejilla con icono y etiqueta corta: ninguna se corta.
 */
const EditionTabs = <T extends string>({
  basePath,
  value,
  tabs,
  ariaLabel,
}: {
  /** `/admin/eventos/<id>`, `/admin/workshops/<slug>`. */
  basePath: string;
  value: T;
  tabs: EditionTabSpec<T>[];
  ariaLabel: string;
}) => {
  const router = useRouter();
  const { confirm } = useCrm();
  const [current, setCurrent] = useState(value);
  return (
    <CrmSegmentedControl
      aria-label={ariaLabel}
      mobileGrid
      className="w-full sm:w-auto"
      value={current}
      onChange={(next) =>
        guardedNavigate(confirm, () => {
          setCurrent(next);
          router.push(`${basePath}?tab=${next}`, { scroll: false });
        })
      }
      segments={tabs.map((t) => ({ ...t, icon: ICONS[t.id] }))}
    />
  );
};

export default EditionTabs;
