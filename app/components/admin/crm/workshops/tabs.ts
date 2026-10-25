import type { EditionTabSpec } from "../editions/status";

/**
 * Las pestañas de un taller, las mismas que las de un evento más «Precio»,
 * «Interesadas» (quien preguntó por WhatsApp: registro de interés, sin pago ni
 * acceso) y «Documentos». Fuera de los componentes cliente: la página del
 * servidor necesita el valor.
 */
export type WorkshopTab = "pagina" | "precio" | "inscritas" | "interesadas" | "documentos" | "whatsapp" | "historia";

export const WORKSHOP_TABS: readonly WorkshopTab[] = [
  "pagina",
  "precio",
  "inscritas",
  "interesadas",
  "documentos",
  "whatsapp",
  "historia",
];

export const parseWorkshopTab = (raw: string | undefined): WorkshopTab =>
  WORKSHOP_TABS.includes(raw as WorkshopTab) ? (raw as WorkshopTab) : "pagina";

export const workshopTabSpecs = (counts: { paid: number; interested: number; documents: number }): EditionTabSpec<WorkshopTab>[] => [
  { id: "pagina", label: "Página" },
  { id: "precio", label: "Precio" },
  { id: "inscritas", label: "Inscritas", count: counts.paid },
  { id: "interesadas", label: "Interesadas", shortLabel: "Interés", count: counts.interested },
  { id: "documentos", label: "Documentos", shortLabel: "Docs", count: counts.documents },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "historia", label: "Historia" },
];
