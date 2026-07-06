"use client";

import { Fragment, useId, useMemo } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { cn } from "@/lib/utils";
import { Label } from "@/app/components/ui/label";
import {
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
  ComboboxValue,
} from "@/app/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import type { SelectOption } from "@/lib/crm/select-option";

export type SearchableSelectOption = SelectOption;

type Props = {
  id?: string;
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  hideLabel?: boolean;
  buttonClassName?: string;
  /** Línea divisoria tras N opciones (ej. países frecuentes). */
  priorityCount?: number;
  /** Mostrar búsqueda si hay al menos N opciones. */
  searchMinOptions?: number;
  /** Ancho mínimo del menú (evita truncar etiquetas largas). */
  panelMinWidth?: number;
  /** Estilo compacto tipo badge para selectores de estado en filas. */
  menuVariant?: "default" | "status";
};

/** Radix/Base UI Select+Combobox items can't use an empty string as a value. */
const EMPTY_OPTION_VALUE = "__empty__";

const SearchableSelect = ({
  id: idProp,
  label,
  value,
  options,
  onChange,
  placeholder = "Seleccionar…",
  searchPlaceholder = "Buscar…",
  allowEmpty = false,
  emptyLabel = "Sin selección",
  required = false,
  disabled = false,
  className = "",
  hideLabel = false,
  buttonClassName = "",
  priorityCount,
  searchMinOptions = 8,
  panelMinWidth,
  menuVariant = "default",
}: Props) => {
  const autoId = useId();
  const id = idProp ?? autoId;
  const showSearch = options.length >= searchMinOptions;

  const contentStyle = panelMinWidth ? { minWidth: panelMinWidth } : undefined;
  const triggerClassName = cn(
    menuVariant === "status" && "h-7 text-xs",
    buttonClassName
  );

  // --- Few options: plain dropdown, no search box (Select) ---
  if (!showSearch) {
    // Base UI's Select.Value resolves its label from Root's `items`/
    // `itemToStringLabel` (it doesn't mirror rendered SelectItem children
    // like Radix does) — without this it displays the raw value string.
    const emptyItem: SearchableSelectOption = { value: EMPTY_OPTION_VALUE, label: emptyLabel };
    const selectItems: SearchableSelectOption[] = allowEmpty
      ? [emptyItem, ...options]
      : options;
    const selectedItem =
      selectItems.find((o) => o.value === (value || EMPTY_OPTION_VALUE)) ?? null;

    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        {!hideLabel && (
          <Label htmlFor={id} className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </Label>
        )}
        <Select
          items={selectItems}
          itemToStringLabel={(item: SearchableSelectOption | null) => item?.label ?? ""}
          value={selectedItem}
          onValueChange={(next: SearchableSelectOption | null) => {
            if (!next) return;
            onChange(next.value === EMPTY_OPTION_VALUE ? "" : next.value);
          }}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            aria-required={required || undefined}
            className={cn("w-full", triggerClassName)}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent style={contentStyle}>
            {allowEmpty && (
              <SelectItem value={emptyItem}>{emptyLabel}</SelectItem>
            )}
            {options.map((o, i) => (
              <Fragment key={o.value}>
                {priorityCount != null && priorityCount > 0 && i === priorityCount && (
                  <SelectSeparator />
                )}
                <SelectItem value={o}>
                  {o.label}
                  {o.hint ? ` (${o.hint})` : ""}
                </SelectItem>
              </Fragment>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // --- Many options: searchable combobox ---
  return (
    <SearchableCombobox
      id={id}
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      placeholder={showSearch ? searchPlaceholder : placeholder}
      allowEmpty={allowEmpty}
      emptyLabel={emptyLabel}
      hideLabel={hideLabel}
      priorityCount={priorityCount}
      contentStyle={contentStyle}
      triggerClassName={triggerClassName}
    />
  );
};

type ComboboxProps = {
  id: string;
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  allowEmpty: boolean;
  emptyLabel: string;
  hideLabel: boolean;
  priorityCount?: number;
  contentStyle?: React.CSSProperties;
  triggerClassName: string;
};

const SearchableCombobox = ({
  id,
  label,
  value,
  options,
  onChange,
  placeholder,
  allowEmpty,
  emptyLabel,
  hideLabel,
  priorityCount,
  contentStyle,
  triggerClassName,
}: ComboboxProps) => {
  const items = useMemo<SearchableSelectOption[]>(
    () =>
      allowEmpty
        ? [{ value: EMPTY_OPTION_VALUE, label: emptyLabel }, ...options]
        : options,
    [options, allowEmpty, emptyLabel]
  );

  const dividerIndex =
    priorityCount != null && priorityCount > 0
      ? priorityCount + (allowEmpty ? 1 : 0)
      : null;
  const dividerBeforeValue = dividerIndex != null ? items[dividerIndex]?.value : undefined;

  const selectedItem =
    items.find((o) => o.value === (value || EMPTY_OPTION_VALUE)) ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      {!hideLabel && (
        <Label htmlFor={id} className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
      )}
      <ComboboxPrimitive.Root
        items={items}
        value={selectedItem}
        onValueChange={(next: SearchableSelectOption | null) => {
          if (!next) return;
          onChange(next.value === EMPTY_OPTION_VALUE ? "" : next.value);
        }}
        itemToStringLabel={(item: SearchableSelectOption | null) => item?.label ?? ""}
      >
        <ComboboxInput
          id={id}
          placeholder={placeholder}
          aria-label={hideLabel ? label : undefined}
          className={triggerClassName}
        />
        <ComboboxContent style={contentStyle}>
          <ComboboxEmpty>Sin coincidencias</ComboboxEmpty>
          <ComboboxList>
            {(item: SearchableSelectOption) => (
              <Fragment key={item.value}>
                {item.value === dividerBeforeValue && <ComboboxSeparator />}
                <ComboboxItem value={item}>
                  <ComboboxValue>{item.label}</ComboboxValue>
                  {item.hint && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {item.hint}
                    </span>
                  )}
                </ComboboxItem>
              </Fragment>
            )}
          </ComboboxList>
        </ComboboxContent>
      </ComboboxPrimitive.Root>
    </div>
  );
};

export default SearchableSelect;
