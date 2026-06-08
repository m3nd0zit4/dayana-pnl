"use client";

import { type ContactFormValues } from "@/app/config/contact-form";
import { contactSourceSelectOptions } from "@/lib/crm/form-select-options";
import { getLocaleSelectOptions } from "@/lib/locale-options";
import { getCountryByIso, suggestTimezoneForCountry } from "@/lib/countries";
import type { CountryCode } from "libphonenumber-js";
import {
  formatLocalPhoneDisplay,
  getLocalPhonePlaceholder,
  sanitizeLocalPhoneInput,
  validateLocalPhone,
} from "@/lib/phone";
import CountrySelect from "./CountrySelect";
import SearchableSelect from "./SearchableSelect";
import TimezoneSelect from "./TimezoneSelect";
import WhatsAppContactBlock from "./WhatsAppContactBlock";

type Props = {
  values: ContactFormValues;
  onChange: (patch: Partial<ContactFormValues>) => void;
  mode: "create" | "edit";
};

const ContactFormFields = ({ values, onChange, mode }: Props) => {
  const countryIso = values.countryIso || values.phoneCountry || "CO";
  const country = getCountryByIso(countryIso);

  const applyCountry = (iso2: string) => {
    if (!iso2) return;
    onChange({
      phoneCountry: iso2,
      countryIso: iso2,
      timezone: suggestTimezoneForCountry(iso2),
    });
  };

  const countryCode = countryIso as CountryCode;
  const rawPhone = values.phone ?? "";
  const digitCount = sanitizeLocalPhoneInput(rawPhone, countryCode).length;
  const phoneValidation = digitCount > 0 ? validateLocalPhone(rawPhone, countryCode) : null;
  const normalizedPreview = phoneValidation?.normalized ?? null;
  const phoneHint = phoneValidation?.hint ?? null;

  const handlePhoneChange = (next: string) => {
    if (next.includes("+")) return;
    onChange({
      phone: sanitizeLocalPhoneInput(next, countryCode),
    });
  };

  const handlePhoneBlur = () => {
    if (!digitCount) return;
    onChange({
      phone: formatLocalPhoneDisplay(rawPhone, countryCode),
    });
  };

  const timezoneHint = country
    ? `Sugerida: ${suggestTimezoneForCountry(countryIso)} (según ${country.name})`
    : "Se ajusta al elegir país o al validar el teléfono";

  return (
    <div className="space-y-4">
      <p className="crm-font-display text-[10px] text-[var(--crm-muted)]">
        Identidad y contacto
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <CountrySelect
            id="cf-country-main"
            label="País"
            value={countryIso}
            onChange={applyCountry}
            required
          />
        </div>

        {mode === "create" && (
          <>
            <div className="sm:col-span-2">
              <label className="crm-label" htmlFor="cf-phone">
                Teléfono WhatsApp *
              </label>
              <div className="crm-phone-field">
                <span className="crm-phone-prefix" aria-hidden>
                  {country?.dialCode ?? "+57"}
                </span>
                <input
                  id="cf-phone"
                  className="crm-phone-input"
                  required
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder={getLocalPhonePlaceholder(countryCode)}
                  value={values.phone ?? ""}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  onBlur={handlePhoneBlur}
                  aria-describedby="cf-phone-hint"
                />
              </div>
              <p
                id="cf-phone-hint"
                className={`mt-1 text-[11px] ${
                  phoneHint
                    ? "text-[var(--crm-danger)]"
                    : "text-[var(--crm-muted)]"
                }`}
              >
                {phoneHint ??
                  "Solo el móvil local, sin + ni prefijo (ya está en País)."}
              </p>
            </div>
            {normalizedPreview && (
              <div className="sm:col-span-2">
                <WhatsAppContactBlock
                  phoneE164={normalizedPreview.phoneE164}
                  compact
                />
              </div>
            )}
          </>
        )}

        {mode === "edit" && (
          <div className="sm:col-span-2 rounded-xl border border-[var(--crm-border)] bg-white/60 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--crm-muted)]">
              Teléfono WhatsApp
            </p>
            <p className="mt-1 font-mono text-sm">{values.phone}</p>
          </div>
        )}

        <div>
          <label className="crm-label" htmlFor="cf-fn">
            Nombre *
          </label>
          <input
            id="cf-fn"
            className="crm-input"
            required
            value={values.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
          />
        </div>
        <div>
          <label className="crm-label" htmlFor="cf-ln">
            Apellido
          </label>
          <input
            id="cf-ln"
            className="crm-input"
            value={values.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="crm-label" htmlFor="cf-dn">
            Nombre para mostrar
          </label>
          <input
            id="cf-dn"
            className="crm-input"
            placeholder="Opcional · si vacío se arma con nombre + apellido"
            value={values.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
          />
        </div>
        <div>
          <label className="crm-label" htmlFor="cf-email">
            Email
          </label>
          <input
            id="cf-email"
            type="email"
            className="crm-input"
            value={values.email}
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </div>
        <div>
          <label className="crm-label" htmlFor="cf-tt">
            TikTok (@usuario)
          </label>
          <input
            id="cf-tt"
            className="crm-input"
            placeholder="@dayana"
            value={values.tiktokHandle}
            onChange={(e) => onChange({ tiktokHandle: e.target.value })}
          />
        </div>
      </div>

      <p className="crm-font-display pt-2 text-[10px] text-[var(--crm-muted)]">
        Ubicación e idioma
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <SearchableSelect
            id="cf-locale"
            label="Idioma preferido"
            value={values.preferredLocale}
            options={getLocaleSelectOptions()}
            onChange={(preferredLocale) => onChange({ preferredLocale })}
            searchPlaceholder="Buscar idioma…"
            searchMinOptions={6}
          />
        </div>
        <div>
          <TimezoneSelect
            id="cf-tz"
            label="Zona horaria (sesiones)"
            value={values.timezone}
            onChange={(timezone) => onChange({ timezone })}
          />
          <p className="mt-1 text-[11px] text-[var(--crm-muted)]">{timezoneHint}</p>
        </div>
      </div>

      <p className="crm-font-display pt-2 text-[10px] text-[var(--crm-muted)]">
        Origen y consentimiento
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <SearchableSelect
            id="cf-source"
            label="Canal de origen"
            value={values.source}
            options={contactSourceSelectOptions()}
            onChange={(source) =>
              onChange({ source: source as ContactFormValues["source"] })
            }
            searchMinOptions={99}
          />
        </div>
        <div>
          <label className="crm-label" htmlFor="cf-sd">
            Detalle origen
          </label>
          <input
            id="cf-sd"
            className="crm-input"
            placeholder="Ej. taller mayo, anuncio TikTok…"
            value={values.sourceDetail}
            onChange={(e) => onChange({ sourceDetail: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.consentData}
            onChange={(e) => onChange({ consentData: e.target.checked })}
            className="rounded border-[var(--crm-border)]"
          />
          Consentimiento datos (RGPD / aviso privacidad)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.consentMarketing}
            onChange={(e) => onChange({ consentMarketing: e.target.checked })}
            className="rounded border-[var(--crm-border)]"
          />
          Consentimiento marketing
        </label>
      </div>

      <div>
        <label className="crm-label" htmlFor="cf-notes">
          Notas internas
        </label>
        <textarea
          id="cf-notes"
          className="crm-textarea"
          placeholder="Contexto clínico, preferencias, historial breve…"
          value={values.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>
    </div>
  );
};

export default ContactFormFields;
