"use client";

import { useState } from "react";
import CheckoutCountrySelect from "../payments/CheckoutCountrySelect";

type Props = {
  enrollmentId?: string;
  planId?: string;
  mode: "legacy" | "email-only";
};

const PostPaymentLeadForm = ({
  enrollmentId,
  planId,
  mode,
  defaultCountry = "CO",
}: Props & { defaultCountry?: string }) => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountry, setPhoneCountry] = useState(defaultCountry);
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      setError("Debes aceptar el tratamiento de datos personales.");
      return;
    }
    if (mode === "email-only" && !email.trim()) {
      setError("Ingresa un correo válido.");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const body =
        mode === "email-only"
          ? {
              email: email.trim(),
              consentData: true,
              enrollmentId,
            }
          : {
              firstName,
              lastName: lastName || undefined,
              phone,
              phoneCountry,
              email: email || undefined,
              consentData: true,
              source: "web",
              enrollmentId,
              planId,
            };

      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setStatus("error");
        setError(data.message ?? "No pudimos guardar tus datos. Intenta de nuevo.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Error de red. Intenta de nuevo.");
    }
  };

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-black/10 bg-white p-6 mb-10 shadow-[0_10px_30px_rgba(20,17,24,0.06)]">
        <p className="font-[font1] text-black/80 text-base leading-relaxed">
          {mode === "email-only"
            ? "Correo guardado. Ya puedes agendar por WhatsApp con el botón de abajo."
            : "Datos guardados. Ya puedes agendar por WhatsApp con el botón de abajo."}
        </p>
      </div>
    );
  }

  if (mode === "email-only") {
    return (
      <form
        onSubmit={submit}
        className="rounded-2xl border border-black/10 bg-white p-6 mb-10 space-y-4"
      >
        <div>
          <h2 className="font-[font2] uppercase text-sm tracking-[0.25em] text-linen/80 mb-1">
            Correo de contacto (opcional)
          </h2>
          <p className="font-[font1] text-black/55 text-sm">
            Tu pago ya quedó vinculado. Si quieres recibir confirmaciones por
            correo, déjanos tu email.
          </p>
        </div>

        <label className="block">
          <span className="font-[font1] text-xs text-black/50 mb-1 block">
            Correo
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-black/15 bg-black/[0.03] px-3 py-2.5 text-[#141118] font-[font1] text-sm placeholder:text-black/35"
          />
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1"
          />
          <span className="font-[font1] text-xs text-black/55 leading-relaxed">
            Acepto el tratamiento de mis datos según el{" "}
            <a href="/aviso-privacidad" className="text-linen underline">
              aviso de privacidad
            </a>
            .
          </span>
        </label>

        {error && (
          <p className="font-[font1] text-sm text-red-300/90">{error}</p>
        )}

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded-full bg-[#141118] text-linen font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-black transition-colors disabled:opacity-50"
        >
          {status === "loading" ? "Guardando…" : "Guardar correo"}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-black/10 bg-white p-6 mb-10 space-y-4"
    >
      <div>
        <h2 className="font-[font2] uppercase text-sm tracking-[0.25em] text-linen/80 mb-1">
          Vincular tu pago
        </h2>
        <p className="font-[font1] text-black/55 text-sm">
          Este pago aún no tiene contacto identificado. Indica tu teléfono para
          vincularlo en el CRM.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="font-[font1] text-xs text-black/50 mb-1 block">
            Nombre *
          </span>
          <input
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full rounded-lg border border-black/15 bg-black/[0.03] px-3 py-2.5 text-[#141118] font-[font1] text-sm placeholder:text-black/35"
          />
        </label>
        <label className="block">
          <span className="font-[font1] text-xs text-black/50 mb-1 block">
            Apellido
          </span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full rounded-lg border border-black/15 bg-black/[0.03] px-3 py-2.5 text-[#141118] font-[font1] text-sm placeholder:text-black/35"
          />
        </label>
      </div>

      <CheckoutCountrySelect
        value={phoneCountry}
        onChange={setPhoneCountry}
        disabled={status === "loading"}
      />

      <label className="block">
        <span className="font-[font1] text-xs text-black/50 mb-1 block">
          WhatsApp / teléfono *
        </span>
        <input
          required
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="300 123 4567"
          className="w-full rounded-lg border border-black/15 bg-black/[0.03] px-3 py-2.5 text-[#141118] font-[font1] text-sm placeholder:text-black/35"
        />
      </label>

      <label className="block">
        <span className="font-[font1] text-xs text-black/50 mb-1 block">
          Correo (opcional)
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-black/15 bg-black/[0.03] px-3 py-2.5 text-[#141118] font-[font1] text-sm placeholder:text-black/35"
        />
      </label>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1"
        />
        <span className="font-[font1] text-xs text-black/55 leading-relaxed">
          Acepto el tratamiento de mis datos según el{" "}
          <a href="/aviso-privacidad" className="text-linen underline">
            aviso de privacidad
          </a>
          .
        </span>
      </label>

      {error && (
        <p className="font-[font1] text-sm text-red-300/90">{error}</p>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-full bg-[#141118] text-linen font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-black transition-colors disabled:opacity-50"
      >
        {status === "loading" ? "Guardando…" : "Vincular mi pago"}
      </button>
    </form>
  );
};

export default PostPaymentLeadForm;
