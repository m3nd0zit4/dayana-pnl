"use client";

import { useState } from "react";
import CheckoutCountrySelect from "./CheckoutCountrySelect";

export type CheckoutContactPayload = {
  phone: string;
  phoneCountry: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  consentData: true;
};

type Props = {
  defaultCountry?: string;
  disabled?: boolean;
  error?: string | null;
  submitLabel?: string;
  onSubmit: (payload: CheckoutContactPayload) => void;
};

const CheckoutContactStep = ({
  defaultCountry = "CO",
  disabled = false,
  error = null,
  submitLabel = "Continuar al pago",
  onSubmit,
}: Props) => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountry, setPhoneCountry] = useState(defaultCountry);
  const [consent, setConsent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      setLocalError("El teléfono es obligatorio.");
      return;
    }
    if (!consent) {
      setLocalError("Debes aceptar el tratamiento de datos personales.");
      return;
    }
    setLocalError(null);
    onSubmit({
      phone: phone.trim(),
      phoneCountry,
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      email: email.trim() || undefined,
      consentData: true,
    });
  };

  const displayError = error ?? localError;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="font-[font2] uppercase text-sm tracking-[0.25em] text-linen/80 mb-1">
          Tus datos de contacto
        </h2>
        <p className="font-[font1] text-white/60 text-sm">
          WhatsApp o teléfono obligatorio para vincular tu pago. El nombre es
          opcional.
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
            className="w-full rounded-lg bg-black/40 border border-linen/20 px-3 py-2.5 text-white font-[font1] text-sm disabled:opacity-50"
          />
        </label>
      </div>

      <CheckoutCountrySelect
        value={phoneCountry}
        onChange={setPhoneCountry}
        disabled={disabled}
      />

      <label className="block">
        <span className="font-[font1] text-xs text-white/50 mb-1 block">
          WhatsApp / teléfono *
        </span>
        <input
          required
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={disabled}
          placeholder="300 123 4567"
          className="w-full rounded-lg bg-black/40 border border-linen/20 px-3 py-2.5 text-white font-[font1] text-sm disabled:opacity-50"
        />
      </label>

      <label className="block">
        <span className="font-[font1] text-xs text-white/50 mb-1 block">
          Correo (opcional)
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg bg-black/40 border border-linen/20 px-3 py-2.5 text-white font-[font1] text-sm disabled:opacity-50"
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
