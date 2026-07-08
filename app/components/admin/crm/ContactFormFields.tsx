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
import { cn } from "@/lib/utils";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/app/components/ui/input-group";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CountrySelect from "./CountrySelect";
import SearchableSelect from "./SearchableSelect";
import TimezoneSelect from "./TimezoneSelect";
import WhatsAppContactBlock from "./WhatsAppContactBlock";

type Props = {
  values: ContactFormValues;
  onChange: (patch: Partial<ContactFormValues>) => void;
  mode: "create" | "edit";
  /** Campos rellenados por IA — se resaltan hasta que el staff los edite. */
  aiFilled?: ReadonlySet<string>;
  /** En edición: permite CAPTURAR el teléfono cuando el contacto no tiene
   * uno real (cuenta creada con Google/correo). Un teléfono existente sigue
   * siendo de solo lectura. */
  allowPhoneEdit?: boolean;
};

const ContactFormFields = ({
  values,
  onChange,
  mode,
  aiFilled,
  allowPhoneEdit = false,
}: Props) => {
  const countryIso = values.countryIso || values.phoneCountry || "CO";
  const country = getCountryByIso(countryIso);
  const phoneEditable = mode === "create" || allowPhoneEdit;

  const aiCls = (field: keyof ContactFormValues) =>
    aiFilled?.has(field) ? "border-purple-300 ring-2 ring-purple-100" : "";

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
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
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

        {phoneEditable && (
          <>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cf-phone">
                Teléfono WhatsApp {mode === "create" ? "*" : "(sin registrar)"}
              </Label>
              <InputGroup className={cn("h-9", aiCls("phone"))}>
                <InputGroupAddon className="text-foreground">
                  {country?.dialCode ?? "+57"}
                </InputGroupAddon>
                <InputGroupInput
                  id="cf-phone"
                  required={mode === "create"}
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder={getLocalPhonePlaceholder(countryCode)}
                  value={values.phone ?? ""}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  onBlur={handlePhoneBlur}
                  aria-describedby="cf-phone-hint"
                />
              </InputGroup>
              <p
                id="cf-phone-hint"
                className={cn(
                  "text-[11px]",
                  phoneHint ? "text-destructive" : "text-muted-foreground"
                )}
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

        {mode === "edit" && !allowPhoneEdit && (
          <div className="rounded-xl border border-border bg-card px-4 py-3 sm:col-span-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Teléfono WhatsApp
            </p>
            <p className="mt-1 font-mono text-sm">{values.phone}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="cf-fn">Nombre *</Label>
          <Input
            id="cf-fn"
            required
            className={aiCls("firstName")}
            value={values.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-ln">Apellido</Label>
          <Input
            id="cf-ln"
            className={aiCls("lastName")}
            value={values.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cf-dn">Nombre para mostrar</Label>
          <Input
            id="cf-dn"
            className={aiCls("displayName")}
            placeholder="Opcional · si vacío se arma con nombre + apellido"
            value={values.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-email">Email</Label>
          <Input
            id="cf-email"
            type="email"
            className={aiCls("email")}
            value={values.email}
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-tt">TikTok (@usuario)</Label>
          <Input
            id="cf-tt"
            className={aiCls("tiktokHandle")}
            placeholder="@dayana"
            value={values.tiktokHandle}
            onChange={(e) => onChange({ tiktokHandle: e.target.value })}
          />
        </div>
      </div>

      <p className="pt-2 text-[10px] text-muted-foreground uppercase tracking-wide">
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
          <p className="mt-1 text-[11px] text-muted-foreground">{timezoneHint}</p>
        </div>
      </div>

      <p className="pt-2 text-[10px] text-muted-foreground uppercase tracking-wide">
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
        <div className="space-y-1.5">
          <Label htmlFor="cf-sd">Detalle origen</Label>
          <Input
            id="cf-sd"
            className={aiCls("sourceDetail")}
            placeholder="Ej. taller mayo, anuncio TikTok…"
            value={values.sourceDetail}
            onChange={(e) => onChange({ sourceDetail: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={values.consentData}
            onCheckedChange={(checked) => onChange({ consentData: checked === true })}
          />
          Consentimiento datos (RGPD / aviso privacidad)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={values.consentMarketing}
            onCheckedChange={(checked) => onChange({ consentMarketing: checked === true })}
          />
          Consentimiento marketing
        </label>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cf-notes">Notas internas</Label>
        <Textarea
          id="cf-notes"
          className={aiCls("notes")}
          placeholder="Contexto clínico, preferencias, historial breve…"
          value={values.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>
    </div>
  );
};

export default ContactFormFields;
