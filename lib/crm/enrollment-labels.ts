import { EnrollmentStatus } from "@prisma/client";

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
