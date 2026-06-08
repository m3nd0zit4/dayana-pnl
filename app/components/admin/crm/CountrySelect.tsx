"use client";

import { useMemo } from "react";
import {
  COUNTRY_OPTIONS_GROUPED,
  formatCountryLabel,
  getCountryByIso,
  PRIORITY_COUNTRY_COUNT,
} from "@/lib/countries";
import SearchableSelect from "./SearchableSelect";

type Props = {
  id?: string;
  label: string;
  value: string;
  onChange: (iso2: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  required?: boolean;
  className?: string;
};

const CountrySelect = ({
  id,
  label,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "Todos los países",
  required = false,
  className = "",
}: Props) => {
  const options = useMemo(
    () =>
      COUNTRY_OPTIONS_GROUPED().map((c) => ({
        value: c.iso2,
        label: c.name,
        hint: c.dialCode,
      })),
    []
  );

  const selected = value ? getCountryByIso(value) : undefined;
  const placeholder = selected
    ? `${selected.name} (${selected.dialCode})`
    : value
      ? formatCountryLabel(value)
      : "Selecciona un país";

  return (
    <SearchableSelect
      id={id}
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Buscar país…"
      allowEmpty={allowEmpty}
      emptyLabel={emptyLabel}
      required={required}
      className={className}
      priorityCount={PRIORITY_COUNTRY_COUNT}
      searchMinOptions={6}
    />
  );
};

export default CountrySelect;
