import { EnrollmentStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PLACEHOLDER_PHONE_PREFIX } from "@/lib/crm/checkout-placeholder";

/**
 * Lo que hay que hacer hoy, para la portada del panel.
 *
 * `/admin` enseñaba estadísticas y gráficas: servía para mirar, no para
 * trabajar. Cada entrada de aquí es una cosa que alguien tiene que resolver,
 * con su número y un enlace a la pantalla donde se resuelve.
 *
 * Los criterios son deliberadamente estrictos: una portada que avisa de todo
 * a diario acaba sin leerse igual que una que no avisa de nada.
 */

export type PendienteKey =
  | "pagos-sin-identificar"
  | "membresias-vencidas"
  | "membresias-por-vencer"
  | "enlaces-sin-pagar"
  | "diagnosticos-sin-compra"
  | "precios-descuadrados"
  | "conversaciones-sin-responder";

export type Pendiente = {
  key: PendienteKey;
  count: number;
  label: string;
  href: string;
  /** `alert`: dinero o acceso en juego ya. `todo`: seguimiento. */
  tone: "alert" | "todo";
};

const DAY = 24 * 60 * 60 * 1000;
/** Ventana de «esta semana» para las membresías que vencen. */
export const PENDIENTES_EXPIRY_WINDOW_DAYS = 7;
/** Hasta dónde se mira atrás para un diagnóstico que no terminó en compra. */
export const PENDIENTES_DIAGNOSTIC_WINDOW_DAYS = 14;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export async function getPendientes(now: Date = new Date()): Promise<Pendiente[]> {
  const inAWeek = new Date(now.getTime() + PENDIENTES_EXPIRY_WINDOW_DAYS * DAY);
  const diagnosticsSince = new Date(now.getTime() - PENDIENTES_DIAGNOSTIC_WINDOW_DAYS * DAY);

  // Una membresía que caduca es una matrícula activa con `paidUntil`, sin
  // acceso de por vida. Las compras sueltas de un curso llevan `lifetimeAccess`
  // y `paidUntil` nulo, y no pueden aparecer aquí como «vencidas».
  const membership = {
    status: EnrollmentStatus.ACTIVE,
    lifetimeAccess: false,
  } as const;

  const [
    unidentified,
    overdue,
    expiring,
    openLinks,
    diagnostics,
    drifted,
    conversations,
  ] = await Promise.all([
    // El mismo criterio que el aviso que había en la portada: cobro aprobado
    // colgado de un contacto `+pending:` que la conciliación no identificó.
    prisma.enrollment.count({
      where: {
        status: EnrollmentStatus.ACTIVE,
        contact: { phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX } },
        payments: { some: { status: PaymentStatus.APPROVED } },
      },
    }),
    prisma.enrollment.count({
      where: { ...membership, paidUntil: { lt: now } },
    }),
    prisma.enrollment.count({
      where: { ...membership, paidUntil: { gte: now, lt: inAWeek } },
    }),
    // Enlaces que alguien abrió y no pagó, y que todavía pueden cobrarse. Un
    // enlace revocado o caducado ya no es trabajo pendiente: no hay nada que
    // reenviar.
    prisma.paymentLink.count({
      where: {
        openedAt: { not: null },
        paidAt: null,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    // Diagnóstico terminado, con persona identificada, y sin una matrícula
    // activada desde entonces. Es la lista de a quién llamar.
    prisma.diagnostic.count({
      where: {
        completedAt: { gte: diagnosticsSince },
        contactId: { not: null },
        contact: {
          enrollments: {
            none: {
              status: EnrollmentStatus.ACTIVE,
              createdAt: { gte: diagnosticsSince },
            },
          },
        },
      },
    }),
    // Un precio que no se propagó a los proveedores: se anuncia uno y los
    // planes cobran otro.
    prisma.product.count({ where: { priceSyncStatus: "DRIFTED" } }),
    prisma.conversation.count({
      where: { status: "OPEN", unreadCount: { gt: 0 } },
    }),
  ]);

  const all: Pendiente[] = [
    {
      key: "pagos-sin-identificar",
      count: unidentified,
      label: plural(unidentified, "pago sin identificar", "pagos sin identificar"),
      href: "/admin/payments?sin-identificar=1",
      tone: "alert",
    },
    {
      key: "precios-descuadrados",
      count: drifted,
      label: plural(drifted, "precio sin sincronizar con las pasarelas", "precios sin sincronizar con las pasarelas"),
      href: "/admin/products",
      tone: "alert",
    },
    {
      key: "membresias-vencidas",
      count: overdue,
      label: plural(overdue, "membresía vencida", "membresías vencidas"),
      href: "/admin/membresias",
      tone: "alert",
    },
    {
      key: "membresias-por-vencer",
      count: expiring,
      label: plural(expiring, "membresía vence esta semana", "membresías vencen esta semana"),
      href: "/admin/membresias",
      tone: "todo",
    },
    {
      key: "enlaces-sin-pagar",
      count: openLinks,
      label: plural(openLinks, "enlace de pago abierto sin pagar", "enlaces de pago abiertos sin pagar"),
      href: "/admin/enlaces-pago",
      tone: "todo",
    },
    {
      key: "diagnosticos-sin-compra",
      count: diagnostics,
      label: plural(diagnostics, "diagnóstico reciente sin compra", "diagnósticos recientes sin compra"),
      href: "/admin/diagnosticos",
      tone: "todo",
    },
    {
      key: "conversaciones-sin-responder",
      count: conversations,
      label: plural(conversations, "conversación sin responder", "conversaciones sin responder"),
      href: "/admin/inbox",
      tone: "todo",
    },
  ];

  return all.filter((p) => p.count > 0);
}
