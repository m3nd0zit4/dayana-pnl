"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, Copy } from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent } from "@/app/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/app/components/ui/collapsible";
import { displayContactPhone } from "@/lib/crm/contact-phone";
import { paymentProviderLabel, subscriptionStatusLabel } from "@/lib/crm/payment-labels";
import type {
  SubscriberRow,
  SubscriptionPlanRow,
} from "@/lib/crm/subscriptions";
import { cn } from "@/lib/utils";
import CrmPageHeader from "./CrmPageHeader";
import CrmMaybeShell from "./CrmMaybeShell";
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
 * Suscripciones: quién se está cobrando cada mes, y con qué planes.
 *
 * Lo que se mira a diario —quién está suscrita y quién requiere atención— va
 * primero. El catálogo de planes (ids, comisión, fecha de la última
 * comprobación) es un dato técnico: sirve para buscar un plan en el panel del
 * proveedor o antes de crear otro, y por eso va plegado debajo.
 *
 * **Un plan de suscripción no se borra**: ni PayPal ni Mercado Pago lo
 * permiten, sólo desactivarlo. La comprobación de precio contra los
 * proveedores vive en Paquetes, que es donde se cambia el precio.
 */

type Props = {
  preview: boolean;
  plans: SubscriptionPlanRow[];
  subscribers: SubscriberRow[];
  /** Dentro de Membresías: sin marco ni cabecera propios. */
  embedded?: boolean;
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

const SubscriptionsPageClient = ({
  preview,
  plans,
  subscribers,
  embedded = false,
}: Props) => {
  const { toast } = useCrm();
  const [filter, setFilter] = useState<Filter>("todas");
  const [plansOpen, setPlansOpen] = useState(false);
  const driftedPlans = plans.filter((p) => p.syncStatus === "DRIFTED").length;

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${what} copiado`);
    } catch {
      toast("No se pudo copiar", "error");
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
    <CrmMaybeShell embedded={embedded}>
      {!embedded && (
        <CrmPageHeader
          title="Suscripciones"
          description="Quién se está cobrando cada mes, y con qué planes de PayPal y Mercado Pago."
        />
      )}

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
                <CrmDataListRow
                  key={row.enrollmentId}
                  actions={
                    row.subscriptionRef ? (
                      <CrmRowActions>
                        <CrmRowAction
                          icon={Copy}
                          label="Copiar el id de la suscripción"
                          onClick={() =>
                            copy(row.subscriptionRef!, "Id de la suscripción")
                          }
                        />
                      </CrmRowActions>
                    ) : undefined
                  }
                >
                  <div className="w-56 min-w-0">
                    <Link
                      href={preview ? "#" : `/admin/contacts/${row.contactId}`}
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
                        ? paymentProviderLabel(row.provider)
                        : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.subscriptionStatus
                        ? subscriptionStatusLabel(row.subscriptionStatus)
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

      <Collapsible open={plansOpen} onOpenChange={setPlansOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50">
          <span>
            Detalles técnicos de los planes
            {driftedPlans > 0 ? (
              <Badge className="ml-2 border-destructive/40 bg-destructive/10 text-destructive">
                {driftedPlans} descuadrado{driftedPlans === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              plansOpen && "rotate-180"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">
            Un plan no se puede borrar: ni PayPal ni Mercado Pago lo permiten,
            sólo desactivarlo. Cambiar el precio reutiliza el plan que ya existe.
            Para comprobar un precio contra los proveedores, ve a{" "}
            <Link href="/admin/products" className="underline underline-offset-2">
              Paquetes
            </Link>
            .
          </p>

          {plans.length === 0 ? (
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

              {plans.map((row) => (
                <CrmDataListRow
                  key={`${row.productId}-${row.provider}`}
                  actions={
                    <CrmRowActions>
                      <CrmRowAction
                        label="Copiar el id del plan"
                        icon={Copy}
                        onClick={() => copy(row.planId, "Id del plan")}
                      />
                    </CrmRowActions>
                  }
                >
                  <div className="w-56 min-w-0">
                    <p className="truncate text-sm font-medium">
                      {row.productTitle}
                    </p>
                    {/* El id es el dato con el que se busca el plan en el panel
                        del proveedor. */}
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {row.planId}
                    </p>
                  </div>

                  <span className="w-32 text-sm">
                    {paymentProviderLabel(row.provider)}
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
                        fijo. */}
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
        </CollapsibleContent>
      </Collapsible>
    </CrmMaybeShell>
  );
};

export default SubscriptionsPageClient;
