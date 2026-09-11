"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { displayContactPhone } from "@/lib/crm/contact-phone";
import type {
  SubscriberRow,
  SubscriptionPlanRow,
} from "@/lib/crm/subscriptions";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmSegmentedControl from "./CrmSegmentedControl";
import { useCrm } from "./CrmProvider";
import { membershipChip } from "./membership-chip";
import {
  CrmDataList,
  CrmDataListHeader,
  CrmDataListRow,
  CrmEmptyState,
  CrmRowAction,
  CrmRowActions,
} from "./ui";

/**
 * Suscripciones: qué planes existen y quién se está cobrando por ellos.
 *
 * Son dos preguntas y por eso son dos bloques. La de arriba no se podía
 * contestar en ninguna pantalla del panel, y es la que más pesa al decidir:
 * **un plan de suscripción no se borra**. Ni PayPal ni Mercado Pago lo
 * permiten, sólo desactivarlo. Así que antes de crear otro hay que poder ver
 * los que ya hay, y con su id — que es lo único con lo que se encuentran en el
 * panel del proveedor.
 *
 * La de abajo separa lo que Miembros mezcla: allí una fila dice si el acceso
 * está al día, y quien paga cada mes y quien pagó suelto se leen igual.
 */

type Props = {
  preview: boolean;
  plans: SubscriptionPlanRow[];
  subscribers: SubscriberRow[];
};

const PROVIDER_LABEL: Record<string, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Manual",
};

const SUBSCRIPTION_STATE_LABEL: Record<string, string> = {
  ACTIVE: "Activa",
  SUSPENDED: "Suspendida",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
};

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-CO", { dateStyle: "medium" }) : "—";

/**
 * El COP no tiene centavos y el USD sí. La misma trampa que ya costó un
 * disgusto en los CSV: dividir siempre entre cien convierte 122.500 pesos en
 * 1.225.
 */
const formatMoney = (minor: number | null, currency: string): string => {
  if (minor == null) return "—";
  const isCop = currency === "COP";
  return new Intl.NumberFormat(isCop ? "es-CO" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: isCop ? 0 : 2,
  }).format(isCop ? minor : minor / 100);
};

type Filter = "todas" | "activas" | "atencion";

const SubscriptionsPageClient = ({ preview, plans, subscribers }: Props) => {
  const { toast } = useCrm();
  const [filter, setFilter] = useState<Filter>("todas");
  const [verifying, setVerifying] = useState<string | null>(null);
  const [rows, setRows] = useState(plans);

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${what} copiado`);
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  /**
   * El viaje a los proveedores va aquí, a un botón, y no a la carga de la
   * pantalla: son dos llamadas externas por producto, y el token de Mercado
   * Pago es productivo incluso en desarrollo. Mirar no debe tocar la cuenta
   * real; comprobar sí, porque se pide.
   */
  const verify = async (productId: string) => {
    setVerifying(productId);
    try {
      const res = await fetch("/api/admin/products/verify-price-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: productId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(data?.error ?? "No se pudo verificar", "error");
        return;
      }
      toast(data.details ?? (data.inSync ? "Todo cuadra" : "Hay diferencias"));
      setRows((prev) =>
        prev.map((row) =>
          row.productId === productId
            ? {
                ...row,
                syncStatus: data.inSync ? "SYNCED" : "DRIFTED",
                syncNote: data.inSync ? null : (data.details ?? null),
                syncCheckedAt: new Date().toISOString(),
              }
            : row
        )
      );
    } finally {
      setVerifying(null);
    }
  };

  const visibleSubscribers = useMemo(() => {
    if (filter === "activas") {
      return subscribers.filter((s) => s.subscriptionStatus === "ACTIVE");
    }
    if (filter === "atencion") {
      // Lo que hay que mirar hoy: sin fecha, vencida, o a menos de una semana.
      return subscribers.filter((s) => {
        const chip = membershipChip(s).label;
        return chip !== "Al día";
      });
    }
    return subscribers;
  }, [subscribers, filter]);

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Suscripciones"
        description="Los planes que existen en PayPal y Mercado Pago, y quién se está cobrando por ellos."
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Planes creados</h2>
          <p className="text-xs text-muted-foreground">
            Un plan no se puede borrar: ni PayPal ni Mercado Pago lo permiten,
            sólo desactivarlo. Cambiar el precio reutiliza el plan que ya existe.
          </p>
        </div>

        {rows.length === 0 ? (
          <CrmEmptyState
            title="No hay ningún plan de suscripción"
            description="Se crean con los scripts de alta de PayPal y Mercado Pago, a partir del precio del producto."
          />
        ) : (
          <CrmDataList>
            <CrmDataListHeader>
              <span className="w-56">Producto</span>
              <span className="w-32">Pasarela</span>
              <span className="w-32">Se anuncia</span>
              <span className="w-36">El plan cobra</span>
              <span className="w-24">Activas</span>
            </CrmDataListHeader>

            {rows.map((row) => (
              <CrmDataListRow
                key={`${row.productId}-${row.provider}`}
                actions={
                  <CrmRowActions>
                    <CrmRowAction
                      label="Copiar el id del plan"
                      icon={Copy}
                      onClick={() => copy(row.planId, "Id del plan")}
                    />
                    <CrmRowAction
                      label="Verificar contra el proveedor"
                      icon={RefreshCw}
                      disabled={verifying === row.productId}
                      onClick={() => verify(row.productId)}
                    />
                  </CrmRowActions>
                }
              >
                <div className="w-56 min-w-0">
                  <p className="truncate text-sm font-medium">
                    {row.productTitle}
                  </p>
                  {/* El id es el dato con el que se busca el plan en el panel
                      del proveedor. Viajaba al cliente y no se pintaba. */}
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {row.planId}
                  </p>
                </div>

                <span className="w-32 text-sm">
                  {PROVIDER_LABEL[row.provider] ?? row.provider}
                </span>

                <span className="w-32 text-sm">
                  {formatMoney(row.netMinor, row.currency)}
                </span>

                <div className="w-36">
                  <p className="text-sm">
                    {formatMoney(row.grossMinor, row.currency)}
                  </p>
                  {/* Anunciado y cobrado no son la misma cifra a propósito: el
                      plan lleva la comisión dentro porque cobra un importe
                      fijo. Enseñar sólo uno de los dos números hace parecer un
                      error lo que es el diseño. */}
                  <p className="text-xs text-muted-foreground">
                    +{formatMoney(row.feeMinor, row.currency)} de comisión
                  </p>
                </div>

                <span className="w-24 text-sm">{row.activeSubscribers}</span>

                <div className="flex flex-wrap items-center gap-2">
                  {!row.isActive && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Producto inactivo
                    </Badge>
                  )}
                  {row.syncStatus === "DRIFTED" ? (
                    <Badge className="border-destructive/40 bg-destructive/10 text-destructive">
                      Descuadrado
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Comprobado: {formatDate(row.syncCheckedAt)}
                    </span>
                  )}
                </div>

                {row.syncNote && (
                  <p className="w-full text-xs text-destructive" role="alert">
                    {row.syncNote}
                  </p>
                )}
              </CrmDataListRow>
            ))}
          </CrmDataList>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Quién está suscrita</h2>
          <CrmSegmentedControl
            segments={[
              { id: "todas" as const, label: "Todas" },
              { id: "activas" as const, label: "Activas" },
              { id: "atencion" as const, label: "Requieren atención" },
            ]}
            value={filter}
            onChange={setFilter}
            aria-label="Filtrar suscripciones"
          />
        </div>

        {visibleSubscribers.length === 0 ? (
          <CrmEmptyState
            title={
              subscribers.length === 0
                ? "Todavía no hay ninguna suscripción"
                : "Nada en este filtro"
            }
            description={
              subscribers.length === 0
                ? "Aparecerán aquí en cuanto alguien se dé de alta por PayPal o por Mercado Pago."
                : "Prueba con «Todas»."
            }
          />
        ) : (
          <CrmDataList>
            <CrmDataListHeader>
              <span className="w-56">Persona</span>
              <span className="w-40">Producto</span>
              <span className="w-32">Pasarela</span>
              <span className="w-36">Vigente hasta</span>
              <span className="w-32">Último pago</span>
            </CrmDataListHeader>

            {visibleSubscribers.map((row) => {
              const chip = membershipChip(row);
              return (
                <CrmDataListRow key={row.enrollmentId}>
                  <div className="w-56 min-w-0">
                    <Link
                      href={`/admin/contacts/${row.contactId}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {row.name || displayContactPhone(row.phoneE164)}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.email ?? displayContactPhone(row.phoneE164)}
                    </p>
                  </div>

                  <span className="w-40 truncate text-sm">
                    {row.productTitle}
                  </span>

                  <div className="w-32">
                    <p className="text-sm">
                      {row.provider
                        ? (PROVIDER_LABEL[row.provider] ?? row.provider)
                        : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.subscriptionStatus
                        ? (SUBSCRIPTION_STATE_LABEL[row.subscriptionStatus] ??
                          row.subscriptionStatus)
                        : "Pago suelto"}
                    </p>
                  </div>

                  <div className="w-36">
                    <p className="text-sm">{formatDate(row.paidUntil)}</p>
                    <Badge variant="outline" className={chip.cls}>
                      {chip.label}
                    </Badge>
                  </div>

                  <div className="w-32">
                    <p className="text-sm">{formatDate(row.lastPaymentAt)}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.paymentsCount} pago(s)
                    </p>
                  </div>

                  {row.subscriptionRef && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="font-mono text-xs text-muted-foreground"
                      onClick={() =>
                        copy(row.subscriptionRef!, "Id de la suscripción")
                      }
                    >
                      {row.subscriptionRef}
                    </Button>
                  )}
                </CrmDataListRow>
              );
            })}
          </CrmDataList>
        )}
      </section>

      {/*
        Cancelar sigue siendo cosa de la suscriptora, desde el portal. No hay
        botón para el staff porque hoy nadie puede cancelar por otra persona, y
        abrir esa puerta merece su propia decisión — no colarse en una pantalla
        que existe para mirar.
      */}
      {!preview && (
        <Card>
          <CardContent className="py-4 text-xs text-muted-foreground">
            Para dar de baja una suscripción, la persona lo hace desde su portal.
            Cancelar detiene la renovación, no el acceso ya pagado: sigue entrando
            hasta la fecha de «Vigente hasta».
          </CardContent>
        </Card>
      )}
    </CrmPageShell>
  );
};

export default SubscriptionsPageClient;
