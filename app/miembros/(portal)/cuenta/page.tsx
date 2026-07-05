import type { Metadata } from "next";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { BRAND } from "@/lib/contact";
import { formatCop, formatUsd } from "@/lib/plans";
import { getVisiblePublicPlans } from "@/lib/pricing/public-plans";
import { requirePortalContext } from "@/lib/lms/portal";
import { getMembershipPayments } from "@/lib/lms/membership";
import MembershipStatusCard from "@/app/components/miembros/MembershipStatusCard";
import RenewMembership from "@/app/components/miembros/RenewMembership";
import ChangePasswordForm from "@/app/components/miembros/ChangePasswordForm";

export const metadata: Metadata = {
  title: `Mi cuenta — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const PROVIDER_LABELS: Record<string, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Registro manual",
};

const formatAmount = (currency: string, amountMinor: number) =>
  currency === "COP"
    ? `${formatCop(amountMinor)} COP`
    : `${formatUsd(amountMinor / 100)} ${currency}`;

const Page = async () => {
  const { contact, account, membership } = await requirePortalContext();
  const { coursePlan, userCountry } = await getVisiblePublicPlans();

  const payments = membership.enrollment
    ? await getMembershipPayments(membership.enrollment.id)
    : [];

  const parsedPhone =
    contact.phoneE164.startsWith("+") && !contact.phoneE164.includes(":")
      ? parsePhoneNumberFromString(contact.phoneE164)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="portal-display text-2xl text-[var(--portal-foreground)] lg:text-3xl">
          Mi cuenta
        </h1>
        <p className="mt-2 text-sm text-[var(--portal-muted)]">
          {contact.displayName ?? contact.firstName}
          {contact.email ? ` · ${contact.email}` : ""}
        </p>
      </div>

      <MembershipStatusCard
        paidUntil={membership.paidUntil}
        isCurrent={membership.isCurrent}
        daysLeft={membership.daysLeft}
        hasEnrollment={membership.enrollment != null}
      />

      <section className="portal-card p-5 sm:p-6">
        <h2 className="portal-display text-[11px] text-[var(--portal-muted)]">
          {membership.enrollment ? "Pagar mi mes" : "Activar membresía"}
        </h2>
        {coursePlan ? (
          <div className="mt-3 max-w-md">
            <p className="text-sm leading-relaxed text-[#33302b]">
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
            <div className="mt-2 text-sm text-[var(--portal-muted)]">
              {formatUsd(coursePlan.amountUsd)} USD
              {coursePlan.amountCop != null
                ? ` · ${formatCop(coursePlan.amountCop)} COP`
                : ""}{" "}
              / mes
            </div>
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
        ) : (
          <p className="mt-3 text-sm text-[var(--portal-muted)]">
            El pago online no está disponible en este momento. Escríbenos por
            WhatsApp para renovar.
          </p>
        )}
      </section>

      <section className="portal-card p-5 sm:p-6">
        <h2 className="portal-display text-[11px] text-[var(--portal-muted)]">
          Historial de pagos
        </h2>
        {payments.length > 0 ? (
          <ul className="mt-3 divide-y divide-[var(--portal-border)]">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="text-sm font-semibold">
                  {formatAmount(payment.currency, payment.amountMinor)}
                </div>
                <div className="text-xs text-[var(--portal-muted)]">
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
          <p className="mt-3 text-sm text-[var(--portal-muted)]">
            Aún no hay pagos registrados.
          </p>
        )}
      </section>

      <section className="portal-card max-w-xl p-5 sm:p-6">
        <h2 className="portal-display text-[11px] text-[var(--portal-muted)]">
          Contraseña
        </h2>
        {!account.passwordHash && account.googleSub ? (
          <p className="mt-3 text-sm leading-relaxed text-[#33302b]">
            Entras con Google. Si quieres, crea también una contraseña para
            poder entrar con tu correo.
          </p>
        ) : null}
        <div className="mt-4">
          <ChangePasswordForm hasPassword={Boolean(account.passwordHash)} />
        </div>
      </section>
    </div>
  );
};

export default Page;
