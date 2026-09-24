"use client";

import type { ReactNode } from "react";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SaveState } from "./SaveIndicator";
import SettingRow from "./SettingRow";

/** El verde de WhatsApp en los interruptores de esta sección. */
export const WA_SWITCH_CLASS = "data-checked:bg-[#00a884] dark:data-checked:bg-[#00a884]";

export const WaSwitch = ({ className, ...props }: React.ComponentProps<typeof Switch>) => (
  <Switch className={cn(WA_SWITCH_CLASS, className)} {...props} />
);

/** Una fila con un interruptor: se guarda en cuanto se toca. */
const ToggleRow = ({
  id,
  label,
  help,
  info,
  state,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  info?: ReactNode;
  state?: SaveState;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) => (
  <SettingRow id={id} label={label} help={help} info={info} state={state} htmlFor={`${id}-switch`} layout="row">
    <WaSwitch id={`${id}-switch`} checked={checked} onCheckedChange={onChange} disabled={disabled} />
  </SettingRow>
);

export default ToggleRow;
