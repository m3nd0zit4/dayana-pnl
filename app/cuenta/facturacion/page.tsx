import Link from "next/link";
import { parsePhoneNumberFromString } from "libphonenumber-js";

import CuentaSection from "@/app/components/cuenta/CuentaSection";
import CancelSubscription from "@/app/components/miembros/CancelSubscription";
import RenewMembership from "@/app/components/miembros/RenewMembership";
import LocalInstantText from "@/app/components/datetime/LocalInstantText";
import { getMemberWorkshops } from "@/lib/crm/member-workshops";
import { getMembershipPayments } from "@/lib/lms/membership";
import { requirePortalContext } from "@/lib/lms/portal";
import { formatCop, formatUsd } from "@/lib/plans";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";

// Ojo: el índice es `string`, no `PaymentProvider`, así que añadir un miembro
// al enum NO rompe el typecheck aquí — sólo deja el pago sin etiqueta en la
// factura del miembro. Mantener en sync con PROVIDER_LABEL de lib/crm/payments.ts.
const PROVIDER_LABELS: Record<string, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Registro manual",
};

const formatAmount = (currency: string, amountMinor: number) =>
  currency === "COP"
    ? `${formatCop(amountMinor)} COP`
    : `${formatUsd(amountMinor / 100)} ${currency}`;

const dateFmt = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  dateStyle: "long",
});

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

  // Quien sólo compró talleres no debe leer textos de membresía («Pagar mi
  // mes»): suena a factura de algo que nunca contrató. Una cuenta nueva sin
  // compras sí los ve, porque activar el curso es su siguiente paso probable.
  const workshopOnly = workshops.length > 0 && membership.enrollment == null;

  /**
   * Suscripción viva: cobra sola, así que NO se ofrece «pagar mi mes» — sería
   * cobrar dos veces el mismo periodo. Cancelada o suspendida vuelve el pago
   * manual, que es la red para no perder el acceso mientras se arregla.
   */
  const subscription =
    (membership.enrollment?.paypalSubscriptionId ||
      membership.enrollment?.mercadoPagoPreapprovalId) &&
    membership.enrollment.subscriptionStatus === "ACTIVE";

  // El estado se dice en una frase, no en una tarjeta aparte con su propio
  // título: es un dato, y arriba de todo es donde se busca.
  const estado = membership.lifetime
    ? "Tu acceso no caduca."
    : membership.isCurrent && membership.paidUntil
      ? `Tu acceso está al día hasta el ${dateFmt.format(membership.paidUntil)}.`
      : membership.paidUntil
        ? `Tu acceso venció el ${dateFmt.format(membership.paidUntil)}.`
        : "Todavía no tienes un acceso activo.";

  return (
    <>
      {!workshopOnly && (
        <CuentaSection title="Tu acceso" description={estado}>
          {coursePlan ? (
            <>
              <p className="font-[font1] text-[15px] leading-relaxed text-black/70">
                Cada pago suma un mes de acceso a las clases en vivo,
                grabaciones y módulos. Usa el correo con el que estás
                registrada aquí
                {contact.email ? (
                  <>
                    {" "}
                    (<strong className="text-ink">{contact.email}</strong>)
                  </>
                ) : null}
                .
              </p>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-black/45">
                {formatUsd(coursePlan.amountUsd)} USD
                {coursePlan.amountCop != null
                  ? ` · ${formatCop(coursePlan.amountCop)} COP`
                  : ""}{" "}
                / mes
              </p>

              {subscription ? (
                <div className="mt-6">
                  <p className="font-[font1] text-[15px] leading-relaxed text-black/70">
                    Se cobra automáticamente cada mes
                    {membership.paidUntil
                      ? ` · próxima renovación alrededor del ${dateFmt.format(
                          membership.paidUntil,
                        )}`
                      : null}
                    .
                  </p>
                  <CancelSubscription paidUntil={membership.paidUntil} />
                </div>
              ) : (
                <div className="mt-6">
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
                </div>
              )}
            </>
          ) : (
            <p className="font-[font1] text-[15px] leading-relaxed text-black/70">
              El pago online no está disponible en este momento. Escríbenos por
              WhatsApp para renovar.
            </p>
          )}
        </CuentaSection>
      )}

      {workshops.length > 0 && (
        <CuentaSection title="Tus talleres">
          <ul className="divide-y divide-black/10">
            {workshops.map((w) => (
              <li
                key={w.enrollmentId}
                className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0"
              >
                <div>
                  <div className="font-[font2] text-sm uppercase">{w.title}</div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-black/45">
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
                      ? `Pagado el ${dateFmt.format(w.paidAt)}`
                      : "Acceso activo"}
                    {w.currency && w.amountMinor != null
                      ? ` · ${formatAmount(w.currency, w.amountMinor)}`
                      : ""}
                  </div>
                </div>
                {w.slug ? (
                  <Link
                    href={`/taller-virtual/${w.slug}`}
                    className="font-[font2] text-[11px] uppercase tracking-[0.2em] text-black/60 underline underline-offset-4 transition-colors hover:text-black"
                  >
                    Ver taller
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </CuentaSection>
      )}

      {!workshopOnly && (
        <CuentaSection title="Tus pagos">
          {payments.length > 0 ? (
            <ul className="divide-y divide-black/10">
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0"
                >
                  <span className="font-[font2] text-sm">
                    {formatAmount(payment.currency, payment.amountMinor)}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/45">
                    {PROVIDER_LABELS[payment.provider] ?? payment.provider}
                    {" · "}
                    {dateFmt.format(payment.paidAt ?? payment.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-[font1] text-[15px] text-black/55">
              Aún no hay pagos registrados.
            </p>
          )}
        </CuentaSection>
      )}
    </>
  );
};

export default Page;
