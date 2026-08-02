"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { type CountryCode } from "libphonenumber-js";
import {
  checkoutContactFieldsSchema,
  type CheckoutContactFields,
} from "@/lib/validations/checkout-contact";
import {
  readStoredCheckoutContact,
  writeStoredCheckoutContact,
} from "@/lib/checkout-contact-storage";
import {
  validateLocalPhone,
  getLocalPhonePlaceholder,
  sanitizeLocalPhoneInput,
} from "@/lib/phone";
import CheckoutCountrySelect from "./CheckoutCountrySelect";

export type CheckoutContactPayload = Pick<
  CheckoutContactFields,
  "phone" | "phoneCountry" | "email" | "firstName" | "lastName" | "consentData"
> & { promoCode?: string };

export type CheckoutContactPrefill = {
  email?: string;
  firstName?: string;
  lastName?: string;
  phoneCountry?: string;
};

type Props = {
  defaultCountry?: string;
  disabled?: boolean;
  error?: string | null;
  submitLabel?: string;
  /** Server-resolved identity (session contact) — seeds the fields; anything
   *  the user types afterwards wins. */
  prefill?: CheckoutContactPrefill | null;
  onSubmit: (payload: CheckoutContactPayload) => void;
};

const CheckoutContactStep = ({
  defaultCountry = "CO",
  disabled = false,
  error = null,
  submitLabel = "Continuar al pago",
  prefill = null,
  onSubmit,
}: Props) => {
  const [firstName, setFirstName] = useState(prefill?.firstName ?? "");
  const [lastName, setLastName] = useState(prefill?.lastName ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [phoneCountry, setPhoneCountry] = useState(
    prefill?.phoneCountry || defaultCountry
  );
  const [promoCode, setPromoCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const { data: session, status: sessionStatus } = useSession();

  useEffect(() => {
    const stored = readStoredCheckoutContact();
    if (!stored) return;
    // Server prefill (session identity) wins over the local draft; the
    // draft only fills what's still empty. Phone is never in the prefill.
    setEmail((v) => v || stored.email);
    setPhone((v) => v || stored.phone);
    setPhoneCountry((v) => v || stored.phoneCountry || defaultCountry);
    if (stored.firstName) setFirstName((v) => v || stored.firstName || "");
    if (stored.lastName) setLastName((v) => v || stored.lastName || "");
  }, [defaultCountry]);

  // Logged-in visitor (member or staff): prefill identity from the session so
  // paying doesn't mean re-typing data we already have. Fills only empty
  // fields — a stored checkout draft or anything the user typed wins. Phone
  // stays manual (the session doesn't carry it). State adjustment during
  // render (the React-recommended alternative to setState-in-effect).
  const [sessionPrefilled, setSessionPrefilled] = useState(false);
  if (
    !sessionPrefilled &&
    sessionStatus === "authenticated" &&
    session?.user?.kind
  ) {
    setSessionPrefilled(true);
    const sessionEmail = session.user.email ?? "";
    const [sessionFirst, ...sessionRest] = (session.user.name ?? "")
      .split(/\s+/)
      .filter(Boolean);
    setEmail((v) => v || sessionEmail);
    setFirstName((v) => v || sessionFirst || "");
    setLastName((v) => v || sessionRest.join(" "));
  }

  // Anonymous returning-buyer autofill: signed-in visitors already get the
  // full session prefill above, so this only fires for logged-out visitors.
  // Silent — never blocks or gates the form, only fills fields the visitor
  // hasn't already touched themselves, and never touches phone/consent.
  const lookedUpEmailRef = useRef<string | null>(null);
  useEffect(() => {
    if (sessionStatus === "authenticated") return;
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) return;
    if (lookedUpEmailRef.current === normalized) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      lookedUpEmailRef.current = normalized;
      fetch("/api/checkout/contact-lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalized }),
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (
            data: {
              found?: boolean;
              prefill?: { firstName?: string; lastName?: string; phoneCountry?: string };
            } | null
          ) => {
            if (!data?.found || !data.prefill) return;
            const { prefill } = data;
            if (prefill.firstName) setFirstName((v) => v || prefill.firstName || "");
            if (prefill.lastName) setLastName((v) => v || prefill.lastName || "");
            if (prefill.phoneCountry) {
              setPhoneCountry((v) => (v === defaultCountry ? prefill.phoneCountry || v : v));
            }
          }
        )
        .catch(() => undefined);
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [email, sessionStatus, defaultCountry]);

  const handlePhoneChange = (raw: string) => {
    const country = phoneCountry as CountryCode;
    const digits = sanitizeLocalPhoneInput(raw, country);
    setPhone(digits);
    if (digits.length >= 6) {
      const { hint } = validateLocalPhone(digits, country);
      setPhoneError(hint);
    } else {
      setPhoneError(null);
    }
  };

  const handleCountryChange = (iso: string) => {
    setPhoneCountry(iso);
    if (phone.length >= 6) {
      const { hint } = validateLocalPhone(phone, iso as CountryCode);
      setPhoneError(hint);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const country = phoneCountry as CountryCode;
    const { normalized, hint } = validateLocalPhone(phone, country);
    if (!normalized) {
      setPhoneError(hint ?? "Por favor ingresa un número válido.");
      return;
    }
    setPhoneError(null);

    const parsed = checkoutContactFieldsSchema.safeParse({
      phone: phone.trim(),
      phoneCountry,
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      email: email.trim(),
      consentData: consent ? true : undefined,
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.path[0] === "phone") {
        setPhoneError(issue.message);
      } else {
        setLocalError(issue?.message ?? "Revisa tus datos.");
      }
      return;
    }

    setLocalError(null);
    const payload: CheckoutContactPayload = {
      phone: parsed.data.phone,
      phoneCountry: parsed.data.phoneCountry ?? defaultCountry,
      email: parsed.data.email.toLowerCase(),
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      consentData: true,
      promoCode: promoCode.trim() || undefined,
    };

    writeStoredCheckoutContact({
      email: payload.email,
      phone: payload.phone,
      phoneCountry: payload.phoneCountry,
      firstName: payload.firstName,
      lastName: payload.lastName,
    });

    onSubmit(payload);
  };

  const displayError = error ?? localError;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="font-[font2] uppercase text-sm tracking-[0.25em] text-linen/80 mb-1">
          Tus datos de contacto
        </h2>
        <p className="font-[font1] text-white/60 text-sm">
          Correo y WhatsApp vinculan tu pago al CRM, envían confirmaciones y
          evitan duplicados si reintentas con otro número.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="font-[font1] text-xs text-white/50 mb-1 block">
            Nombre
          </span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={disabled}
            autoComplete="given-name"
            className="w-full rounded-lg bg-black/40 border border-linen/20 px-3 py-2.5 text-white font-[font1] text-sm disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="font-[font1] text-xs text-white/50 mb-1 block">
            Apellido
          </span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={disabled}
            autoComplete="family-name"
            className="w-full rounded-lg bg-black/40 border border-linen/20 px-3 py-2.5 text-white font-[font1] text-sm disabled:opacity-50"
          />
        </label>
      </div>

      <label className="block">
        <span className="font-[font1] text-xs text-white/50 mb-1 block">
          Correo electrónico *
        </span>
        <input
          required
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled}
          placeholder="tu@correo.com"
          className="w-full rounded-lg bg-black/40 border border-linen/20 px-3 py-2.5 text-white font-[font1] text-sm disabled:opacity-50"
        />
      </label>

      <CheckoutCountrySelect
        value={phoneCountry}
        onChange={handleCountryChange}
        disabled={disabled}
      />

      <div className="block">
        <label className="block">
          <span className="font-[font1] text-xs text-white/50 mb-1 block">
            WhatsApp / teléfono *
          </span>
          <input
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            disabled={disabled}
            placeholder={getLocalPhonePlaceholder(phoneCountry as CountryCode)}
            className={`w-full rounded-lg bg-black/40 border px-3 py-2.5 text-white font-[font1] text-sm disabled:opacity-50 ${
              phoneError
                ? "border-red-400/70 focus:outline-none focus:ring-1 focus:ring-red-400/50"
                : "border-linen/20"
            }`}
          />
        </label>
        {phoneError && (
          <p className="font-[font1] text-xs text-red-300/90 mt-1">
            {phoneError}
          </p>
        )}
      </div>

      <label className="block">
        <span className="font-[font1] text-xs text-white/50 mb-1 block">
          Código promocional (opcional)
        </span>
        <input
          value={promoCode}
          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
          disabled={disabled}
          placeholder="Ej. VERANO2026"
          className="w-full rounded-lg bg-black/40 border border-linen/20 px-3 py-2.5 text-white font-[font1] text-sm disabled:opacity-50 uppercase"
        />
      </label>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={disabled}
          className="mt-1"
        />
        <span className="font-[font1] text-xs text-white/60 leading-relaxed">
          Acepto el tratamiento de mis datos según el{" "}
          <a href="/aviso-privacidad" className="text-linen underline">
            aviso de privacidad
          </a>
          .
        </span>
      </label>

      {displayError && (
        <p className="font-[font1] text-sm text-red-300/90">{displayError}</p>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="w-full rounded-full bg-linen text-black font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-white transition-colors disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </form>
  );
};

export default CheckoutContactStep;
