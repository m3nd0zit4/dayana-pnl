import type { SelectOption } from "@/lib/crm/select-option";

export const THEME_PREFERENCE_OPTIONS: SelectOption[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

export const LOCALE_OPTIONS: SelectOption[] = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
];

/** "What best describes your work" — member portal General tab only. */
export const WORK_DESCRIPTION_OPTIONS: SelectOption[] = [
  { value: "estudiante", label: "Estudiante" },
  { value: "salud_mental", label: "Profesional de salud mental" },
  { value: "coach_terapeuta", label: "Coach / Terapeuta" },
  { value: "emprendedor", label: "Emprendedor(a)" },
  { value: "otro", label: "Otro" },
];
