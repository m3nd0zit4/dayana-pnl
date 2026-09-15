import type { EnrollmentStatus } from "@prisma/client";

export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  LEAD: "Lead",
  PENDING_PAYMENT: "Pago pendiente",
  ACTIVE: "Activo",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
};

export const enrollmentStatusLabel = (status: string): string =>
  ENROLLMENT_STATUS_LABEL[status as EnrollmentStatus] ?? status;

/** Plural, para contar inscripciones por estado (Inicio, Estadísticas). */
export const ENROLLMENT_STATUS_PLURAL_LABEL: Record<EnrollmentStatus, string> = {
  LEAD: "Leads",
  PENDING_PAYMENT: "Pago pendiente",
  ACTIVE: "Activos",
  COMPLETED: "Completados",
  CANCELLED: "Cancelados",
  REFUNDED: "Reembolsados",
};

export const enrollmentStatusPluralLabel = (status: string): string =>
  ENROLLMENT_STATUS_PLURAL_LABEL[status as EnrollmentStatus] ?? status;
