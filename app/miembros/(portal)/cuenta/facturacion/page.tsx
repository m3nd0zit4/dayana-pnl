import { parsePhoneNumberFromString } from "libphonenumber-js";
import { formatCop, formatUsd } from "@/lib/plans";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";
import Link from "next/link";
import { requirePortalContext } from "@/lib/lms/portal";
import { getMembershipPayments } from "@/lib/lms/membership";
import { getMemberWorkshops } from "@/lib/crm/member-workshops";
import MembershipStatusCard from "@/app/components/miembros/MembershipStatusCard";
import RenewMembership from "@/app/components/miembros/RenewMembership";
import CancelSubscription from "@/app/components/miembros/CancelSubscription";
import LocalInstantText from "@/app/components/datetime/LocalInstantText";
import { Card, CardContent } from "@/app/components/ui/card";

// Ojo: el índice es `string`, no `PaymentProvider`, así que añadir un miembro
// al enum NO rompe el typecheck aquí — sólo deja el pago sin etiqueta en la
// factura del miembro. Mantener en sync con PROVIDER_LABEL de lib/crm/payments.ts.
const PROVIDER_LABELS: Record<string, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Registro manual",
  STRIPE: "Stripe",
  LEMON_SQUEEZY: "Lemon Squeezy",
};

const formatAmount = (currency: string, amountMinor: number) =>
  currency === "COP"
    ? `${formatCop(amountMinor)} COP`
    : `${formatUsd(amountMinor / 100)} ${currency}`;

const Page = async () => {
  const { contact, membership } = await requirePortalContext();
  const { coursePlan, userCountry } = await getVisiblePublicPlans();

  const [payments, workshops] = await Promise.all([
    membership.enrollment
      ? getMembershipPayments(membership.enrollment.id)
      : Promise.resolve([]),
    getMemberWorkshops(contact.id),
  ]);

  const parsedPhone =
    contact.phoneE164.startsWith("+") && !contact.phoneE164.includes(":")
      ? parsePhoneNumberFromString(contact.phoneE164)
      : null;

  // Members who only bought workshops shouldn't see course-membership
  // copy ("Pagar mi mes") — it reads like a bill for something they never
  // signed up for. Fresh accounts with no purchases still see it, since
  // activating the course is their most likely next step.
  const workshopOnly = workshops.length > 0 && membership.enrollment == null;

  /**
   * Suscripción viva: cobra sola, así que NO se ofrece "pagar mi mes" — sería
   * cobrar dos veces el mismo periodo. Cancelada o suspendida vuelve el pago
   * manual, que es la red para no perder el acceso mientras se arregla.
   */
  const subscription =
    membership.enrollment?.paypalSubscriptionId &&
    membership.enrollment.subscriptionStatus === "ACTIVE";

  return (
    <div className="space-y-6">
      {workshops.length > 0 && (
        <Card>
          <CardContent>
            <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Mis talleres
            </h2>
            <ul className="mt-3 divide-y divide-border">
              {workshops.map((w) => (
                <li
                  key={w.enrollmentId}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold">{w.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {w.startsAtIso ? (
                        <>
                          <LocalInstantText
                            startsAtIso={w.startsAtIso}
                            mode="date"
                            placeholder={w.dateLabel ?? "…"}
                          />
                          {" · "}
                        </>
                      ) : w.dateLabel ? (
                        `${w.dateLabel} · `
                      ) : (
                        ""
                      )}
                      {w.paidAt
                        ? `Pagado el ${w.paidAt.toLocaleDateString("es-CO", { dateStyle: "medium" })}`
                        : "Acceso activo"}
                      {w.currency && w.amountMinor != null
                        ? ` · ${formatAmount(w.currency, w.amountMinor)}`
                        : ""}
                    </div>
                  </div>
                  {w.slug ? (
                    <Link
                      href={`/taller-virtual/${w.slug}`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      Ver taller
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!workshopOnly && (
        <MembershipStatusCard
          paidUntil={membership.paidUntil}
          isCurrent={membership.isCurrent}
          daysLeft={membership.daysLeft}
          hasEnrollment={membership.enrollment != null}
          hideAction
        />
      )}

      {!workshopOnly && (
      <Card>
        <CardContent>
          <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
            {subscription
              ? "Tu suscripción"
              : membership.enrollment
                ? "Pagar mi mes"
                : "Activar membresía"}
          </h2>
          {coursePlan ? (
            <div className="mt-3 max-w-md">
              <p className="text-sm leading-relaxed">
                Cada pago suma un mes de acceso a las clases en vivo, grabaciones
                y módulos. Usa el correo con el que estás registrada aquí
                {contact.email ? (
                  <>
                    {" "}
                    (<strong>{contact.email}</strong>)
                  </>
                ) : null}
                .
              </p>
              <div className="mt-2 text-sm text-muted-foreground">
                {formatUsd(coursePlan.amountUsd)} USD
                {coursePlan.amountCop != null
                  ? ` · ${formatCop(coursePlan.amountCop)} COP`
                  : ""}{" "}
                / mes
              </div>
              {/*
                Con suscripción viva no se ofrece pagar otro mes: se cobraría
                dos veces por el mismo periodo. Se muestra el estado y la
                salida.
              */}
              {subscription ? (
                <>
                  <p className="mt-3 text-sm leading-relaxed">
                    Se cobra automáticamente cada mes
                    {membership.paidUntil ? (
                      <>
                        {" "}
                        · próxima renovación alrededor del{" "}
                        {new Intl.DateTimeFormat("es-CO", {
                          timeZone: "America/Bogota",
                          dateStyle: "long",
                        }).format(membership.paidUntil)}
                      </>
                    ) : null}
                    .
                  </p>
                  <CancelSubscription paidUntil={membership.paidUntil} />
                </>
              ) : (
              <RenewMembership
                plan={coursePlan}
                userCountry={userCountry}
                prefill={{
                  email: contact.email,
                  phone: parsedPhone?.nationalNumber ?? null,
                  phoneCountry: parsedPhone?.country ?? contact.countryIso,
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                }}
              />
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              El pago online no está disponible en este momento. Escríbenos por
              WhatsApp para renovar.
            </p>
          )}
        </CardContent>
      </Card>
      )}

      {!workshopOnly && (
      <Card>
        <CardContent>
          <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Historial de pagos
          </h2>
          {payments.length > 0 ? (
            <ul className="mt-3 divide-y divide-border">
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="text-sm font-semibold">
                    {formatAmount(payment.currency, payment.amountMinor)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {PROVIDER_LABELS[payment.provider] ?? payment.provider}
                    {" · "}
                    {(payment.paidAt ?? payment.createdAt).toLocaleDateString(
                      "es-CO",
                      { dateStyle: "medium" }
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Aún no hay pagos registrados.
            </p>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
};

export default Page;
