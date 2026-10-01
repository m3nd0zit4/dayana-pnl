"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import CrmSegmentedControl from "../CrmSegmentedControl";
import type { FreeEventTab } from "./tabs";

/**
 * Las pestañas de un evento. Cada una es una URL (`?tab=`): se carga en el
 * servidor solo lo de la pestaña abierta, y un aviso puede llevar directo a
 * «Inscritas» o a «Historia».
 */
const FreeEventTabs = ({
  eventId,
  value,
  registrations,
}: {
  eventId: string;
  value: FreeEventTab;
  registrations: number;
}) => {
  const router = useRouter();
  const [current, setCurrent] = useState(value);
  return (
    <CrmSegmentedControl
      aria-label="Secciones del evento"
      // En un teléfono estrecho las cuatro pestañas se desplazan, la página no.
      className="max-w-full overflow-x-auto"
      value={current}
      onChange={(next) => {
        setCurrent(next);
        router.push(`/admin/eventos/${eventId}?tab=${next}`, { scroll: false });
      }}
      segments={[
        { id: "pagina", label: "Página" },
        { id: "inscritas", label: "Inscritas", count: registrations },
        { id: "whatsapp", label: "WhatsApp" },
        { id: "historia", label: "Historia" },
      ]}
    />
  );
};

export default FreeEventTabs;
