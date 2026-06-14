"use client";

type Segment<T extends string> = {
  id: T;
  label: string;
  count?: number;
};

type Props<T extends string> = {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  "aria-label"?: string;
};

const CrmSegmentedControl = <T extends string>({
  segments,
  value,
  onChange,
  className = "",
  "aria-label": ariaLabel = "Secciones",
}: Props<T>) => (
  <div
    className={`crm-segmented ${className}`.trim()}
    role="tablist"
    aria-label={ariaLabel}
  >
    {segments.map((seg) => {
      const active = seg.id === value;
      const label =
        seg.count != null ? `${seg.label} (${seg.count})` : seg.label;
      return (
        <button
          key={seg.id}
          type="button"
          role="tab"
          aria-selected={active}
          className={`crm-segmented-item${active ? " is-active" : ""}`}
          onClick={() => onChange(seg.id)}
        >
          {label}
        </button>
      );
    })}
  </div>
);

export default CrmSegmentedControl;
