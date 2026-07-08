"use client";

import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";

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
  <Tabs
    value={value}
    onValueChange={(next) => {
      if (typeof next === "string") onChange(next as T);
    }}
    className={className}
  >
    <TabsList aria-label={ariaLabel}>
      {segments.map((seg) => (
        <TabsTrigger key={seg.id} value={seg.id}>
          {seg.count != null ? `${seg.label} (${seg.count})` : seg.label}
        </TabsTrigger>
      ))}
    </TabsList>
  </Tabs>
);

export default CrmSegmentedControl;
