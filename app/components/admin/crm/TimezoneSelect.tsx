"use client";

import { useMemo } from "react";
import { getTimezoneSelectOptions, TIMEZONE_PRIORITY_COUNT } from "@/lib/timezones";
import SearchableSelect from "./SearchableSelect";

type Props = {
  id?: string;
  label: string;
  value: string;
  onChange: (tz: string) => void;
  required?: boolean;
  className?: string;
};

const TimezoneSelect = ({
  id,
  label,
  value,
  onChange,
  required,
  className,
}: Props) => {
  const options = useMemo(() => {
    const base = getTimezoneSelectOptions();
    if (!value || base.some((o) => o.value === value)) return base;
    return [{ value, label: value, hint: undefined }, ...base];
  }, [value]);

  return (
    <SearchableSelect
      id={id}
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      searchPlaceholder="Buscar ciudad o país…"
      placeholder="Selecciona zona horaria"
      required={required}
      className={className}
      priorityCount={TIMEZONE_PRIORITY_COUNT}
      searchMinOptions={6}
    />
  );
};

export default TimezoneSelect;
