"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import type { CountryCode } from "libphonenumber-js";
import {
  getLocalPhonePlaceholder,
  sanitizeLocalPhoneInput,
  validateLocalPhone,
} from "@/lib/phone";
import CheckoutCountrySelect from "@/app/components/payments/CheckoutCountrySelect";

const inputClass =
  "w-full rounded-xl border border-linen/20 bg-black/30 px-4 py-3.5 font-[font1] text-sm text-white placeholder-white/30 transition-colors focus:border-terracotta focus:outline-none";

const labelClass =
  "mb-2 block font-[font2] uppercase text-[10px] tracking-[0.22em] text-white/50";

type CompleteProfileFormProps = {
  firstName: string;
  lastName: string;
  defaultCountry: string;
  callbackUrl: string;
};

/**
 * Onboarding's last mile: Google/email signup never captures a phone number,
 * so a member without one lands here (gated in proxy.ts) before touching the
 * rest of the portal. Same phone step as the signup wizard, just standalone.
 */
const CompleteProfileForm = ({
  firstName,
  lastName,
  defaultCountry,
  callbackUrl,
}: CompleteProfileFormProps) => {
  const { update: updateSession } = useSession();
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState(defaultCountry || "CO");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const country = phoneCountry as CountryCode;
    const { normalized, hint } = validateLocalPhone(phone, country);
    if (!normalized) {
      setPhoneError(hint ?? "Por favor ingresa un número válido.");
      return;
    }
    setPhoneError(null);
    setLoading(true);

    const res = await fetch("/api/miembros/perfil", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName: lastName || null,
        phone: normalized.phoneE164,
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(
        data?.error === "phone_taken"
          ? "Ese número ya está registrado con otra cuenta."
          : "No se pudo guardar. Intenta de nuevo."
      );
      return;
    }

    await updateSession().catch(() => undefined);
    window.location.href = callbackUrl;
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <CheckoutCountrySelect
        value={phoneCountry}
        onChange={handleCountryChange}
        disabled={loading}
      />

      <div>
        <span className={labelClass}>WhatsApp / teléfono</span>
        <input
          type="tel"
          required
          autoFocus
          inputMode="tel"
          autoComplete="tel-national"
          value={phone}
          onChange={(e) => handlePhoneChange(e.target.value)}
          disabled={loading}
          placeholder={getLocalPhonePlaceholder(phoneCountry as CountryCode)}
          className={inputClass}
        />
        {phoneError && (
          <p className="mt-1.5 font-[font1] text-xs text-red-300/90">
            {phoneError}
          </p>
        )}
      </div>

      {error && (
        <p className="font-[font1] text-[13px] text-blush" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-linen py-3.5 font-[font2] uppercase text-xs tracking-[0.25em] text-black transition-colors hover:bg-white disabled:opacity-60"
      >
        {loading ? "Guardando…" : "Continuar"}
      </button>
    </form>
  );
};

export default CompleteProfileForm;
