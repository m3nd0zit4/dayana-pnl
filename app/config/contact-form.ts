import { ContactSource } from "@prisma/client";

export const CONTACT_SOURCE_OPTIONS: { value: ContactSource; label: string }[] =
  [
    { value: "WHATSAPP_DIRECT", label: "WhatsApp directo" },
    { value: "WEB", label: "Web / checkout" },
    { value: "TIKTOK", label: "TikTok" },
    { value: "INSTAGRAM", label: "Instagram" },
    { value: "YOUTUBE", label: "YouTube" },
    { value: "REFERRAL", label: "Referido" },
    { value: "OTHER", label: "Otro" },
  ];

export const LOCALE_OPTIONS = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
];

export const COMMON_TIMEZONES = [
  "America/Bogota",
  "America/Mexico_City",
  "America/New_York",
  "America/Los_Angeles",
  "America/Argentina/Buenos_Aires",
  "America/Santiago",
  "Europe/Madrid",
  "Europe/London",
  "UTC",
];

export type ContactFormValues = {
  phone?: string;
  phoneCountry: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  countryIso: string;
  timezone: string;
  preferredLocale: string;
  source: ContactSource;
  sourceDetail: string;
  tiktokHandle: string;
  notes: string;
  consentData: boolean;
  consentMarketing: boolean;
};

export const emptyContactForm = (): ContactFormValues => ({
  phoneCountry: "CO",
  firstName: "",
  lastName: "",
  displayName: "",
  email: "",
  countryIso: "CO",
  timezone: "America/Bogota",
  preferredLocale: "es",
  source: "WHATSAPP_DIRECT",
  sourceDetail: "",
  tiktokHandle: "",
  notes: "",
  consentData: true,
  consentMarketing: false,
});

export const contactToFormValues = (c: {
  phoneE164?: string;
  phoneCountryIso?: string | null;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  countryIso: string | null;
  timezone: string;
  preferredLocale: string;
  source: ContactSource;
  sourceDetail: string | null;
  tiktokHandle: string | null;
  notes: string | null;
  consentDataAt?: Date | null;
  consentMarketingAt?: Date | null;
}): ContactFormValues => ({
  phone: c.phoneE164,
  phoneCountry: c.phoneCountryIso ?? "CO",
  firstName: c.firstName,
  lastName: c.lastName ?? "",
  displayName: c.displayName ?? "",
  email: c.email ?? "",
  countryIso: c.countryIso ?? c.phoneCountryIso ?? "CO",
  timezone: c.timezone,
  preferredLocale: c.preferredLocale,
  source: c.source,
  sourceDetail: c.sourceDetail ?? "",
  tiktokHandle: c.tiktokHandle ?? "",
  notes: c.notes ?? "",
  consentData: !!c.consentDataAt,
  consentMarketing: !!c.consentMarketingAt,
});
