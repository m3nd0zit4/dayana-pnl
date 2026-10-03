import type { EditionTabSpec } from "../editions/status";

/**
 * Las pestañas de un evento. Vive fuera de los componentes cliente porque la
 * página, que es del servidor, necesita el valor: importado de un módulo
 * «use client» sería una referencia, no la lista.
 */
export type FreeEventTab = "pagina" | "inscritas" | "whatsapp" | "historia";

export const FREE_EVENT_TABS: readonly FreeEventTab[] = ["pagina", "inscritas", "whatsapp", "historia"];

export const parseFreeEventTab = (raw: string | undefined): FreeEventTab =>
  FREE_EVENT_TABS.includes(raw as FreeEventTab) ? (raw as FreeEventTab) : "pagina";

export const freeEventTabSpecs = (registrations: number): EditionTabSpec<FreeEventTab>[] => [
  { id: "pagina", label: "Página" },
  { id: "inscritas", label: "Inscritas", count: registrations },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "historia", label: "Historia" },
];
