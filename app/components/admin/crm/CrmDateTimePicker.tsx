"use client";

import { useState } from "react";
import { es } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/app/components/ui/button";
import { Calendar } from "@/app/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  formatDateTimeShortEs,
  HOUR_OPTIONS_12,
  MINUTE_OPTIONS,
  parseDateTimeLocal,
  to12Hour,
  to24Hour,
  toDateTimeLocal,
} from "@/lib/crm/datetime-local";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
};

const CrmDateTimePicker = ({
  id,
  value,
  onChange,
  disabled = false,
  className = "",
  placeholder = "dd/mm/aaaa, hh:mm a. m.",
}: Props) => {
  const [open, setOpen] = useState(false);
  const parsed = parseDateTimeLocal(value);
  const [date, setDate] = useState<Date>(() => parsed?.date ?? new Date());
  const [hour, setHour] = useState(() => parsed?.hour ?? 10);
  const [minute, setMinute] = useState(() => parsed?.minute ?? 0);

  // Adjust local state when `value` changes externally (React's documented
  // pattern for deriving state from props during render, not in an effect).
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    const p = parseDateTimeLocal(value);
    if (p) {
      setDate(p.date);
      setHour(p.hour);
      setMinute((Math.round(p.minute / 5) * 5) % 60);
    }
  }

  const emit = (d: Date, h: number, m: number) => {
    onChange(toDateTimeLocal(d, h, m));
  };

  const pickDate = (next: Date | undefined) => {
    if (!next) return;
    setDate(next);
    emit(next, hour, minute);
  };

  const pickHour12 = (h12: number) => {
    const { period } = to12Hour(hour);
    const h24 = to24Hour(h12, period);
    setHour(h24);
    emit(date, h24, minute);
  };

  const pickPeriod = (period: "AM" | "PM") => {
    const { hour12 } = to12Hour(hour);
    const h24 = to24Hour(hour12, period);
    setHour(h24);
    emit(date, h24, minute);
  };

  const pickMinute = (m: number) => {
    setMinute(m);
    emit(date, hour, m);
  };

  const setToday = () => {
    const now = new Date();
    const roundedMin = Math.round(now.getMinutes() / 5) * 5;
    const m = roundedMin === 60 ? 0 : roundedMin;
    const h = roundedMin === 60 ? (now.getHours() + 1) % 24 : now.getHours();
    setDate(now);
    setHour(h);
    setMinute(m);
    emit(now, h, m);
  };

  const clear = () => {
    onChange("");
    setOpen(false);
  };

  const { hour12, period } = to12Hour(hour);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("w-full justify-between font-normal", className)}
          />
        }
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left",
            !value && "text-muted-foreground"
          )}
        >
          {value ? formatDateTimeShortEs(value) : placeholder}
        </span>
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          <Calendar
            mode="single"
            selected={date}
            onSelect={pickDate}
            locale={es}
            className="border-b p-3 sm:border-b-0 sm:border-r"
          />
          <div className="flex flex-col gap-3 p-3 sm:w-36">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Hora
              </p>
              <div className="flex items-center gap-1">
                <Select
                  value={String(hour12)}
                  onValueChange={(v) => v && pickHour12(Number(v))}
                >
                  <SelectTrigger className="h-8 w-14" disabled={disabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOUR_OPTIONS_12.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span aria-hidden className="text-muted-foreground">
                  :
                </span>
                <Select
                  value={String(minute)}
                  onValueChange={(v) => v && pickMinute(Number(v))}
                >
                  <SelectTrigger className="h-8 w-16" disabled={disabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MINUTE_OPTIONS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {String(m).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={period}
                  onValueChange={(v) => v && pickPeriod(v as "AM" | "PM")}
                >
                  <SelectTrigger className="h-8 w-16" disabled={disabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">a. m.</SelectItem>
                    <SelectItem value="PM">p. m.</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-auto flex flex-col gap-1.5">
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={setToday}
                  disabled={disabled}
                >
                  Hoy
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={clear}
                  disabled={disabled}
                >
                  Limpiar
                </Button>
              </div>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Listo
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default CrmDateTimePicker;
