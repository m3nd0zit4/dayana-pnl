import type {
  NotificationEventType,
  NotificationSeverity,
} from "@prisma/client";
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CreditCard,
  GraduationCap,
  Info,
  ShieldAlert,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import {
  NOTIFICATION_CATALOG,
  type NotificationGroup,
} from "@/lib/notifications/platform/catalog";

/**
 * Icono y color de cada notificación, derivados del catálogo.
 *
 * Deliberadamente NO hay un mapa evento → icono: un evento nuevo en el enum de
 * Prisma solo tiene que existir en el catálogo para renderizar bien. Si además
 * el catálogo llegara a faltar (cliente viejo, servidor nuevo), caemos a la
 * severidad que ya viene en el propio elemento del feed.
 */

export type NotificationTone = "info" | "success" | "warning" | "error";

const TONE_BY_SEVERITY: Record<NotificationSeverity, NotificationTone> = {
  INFO: "info",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error",
};

const ICON_BY_GROUP: Record<NotificationGroup, LucideIcon> = {
  "Pagos y ventas": CreditCard,
  "Embudo e inscripciones": UserPlus,
  Terapias: CalendarClock,
  "Curso y membresía": GraduationCap,
  "Sistema y seguridad": ShieldAlert,
};

const ICON_BY_TONE: Record<NotificationTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};

/** Clases de color del icono, por tono. */
export const TONE_ICON_CLASS: Record<NotificationTone, string> = {
  info: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  error: "bg-destructive/10 text-destructive",
};

/** Clases del punto de "sin leer", por tono. */
export const TONE_DOT_CLASS: Record<NotificationTone, string> = {
  info: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-destructive",
};

export const severityTone = (severity: NotificationSeverity): NotificationTone =>
  TONE_BY_SEVERITY[severity] ?? "info";

/**
 * El icono de un evento. La severidad manda cuando es WARNING/ERROR (un pago
 * fallido debe verse como alerta, no como una tarjeta de crédito); en INFO y
 * SUCCESS gana el grupo, que es más informativo.
 */
export const notificationIcon = (
  eventType: NotificationEventType,
  severity: NotificationSeverity
): LucideIcon => {
  const tone = severityTone(severity);
  if (tone === "warning" || tone === "error") return ICON_BY_TONE[tone];
  const entry = NOTIFICATION_CATALOG[eventType] as
    | (typeof NOTIFICATION_CATALOG)[NotificationEventType]
    | undefined;
  return entry ? ICON_BY_GROUP[entry.group] : ICON_BY_TONE[tone];
};

/** Etiqueta legible del evento; el eventType crudo si el catálogo no lo conoce. */
export const notificationLabel = (eventType: NotificationEventType): string => {
  const entry = NOTIFICATION_CATALOG[eventType] as
    | (typeof NOTIFICATION_CATALOG)[NotificationEventType]
    | undefined;
  return entry?.label ?? eventType;
};

/** Grupo del evento, o null si el catálogo no lo conoce. */
export const notificationGroup = (
  eventType: NotificationEventType
): NotificationGroup | null => {
  const entry = NOTIFICATION_CATALOG[eventType] as
    | (typeof NOTIFICATION_CATALOG)[NotificationEventType]
    | undefined;
  return entry?.group ?? null;
};
