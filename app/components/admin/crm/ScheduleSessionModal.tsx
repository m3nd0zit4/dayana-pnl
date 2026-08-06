"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  DEFAULT_OPERATIONAL_TZ,
  getDateKeyInTz,
  getTimeHmInTz,
  zonedDateTimeToUtc,
} from "@/lib/datetime/zoned-time";
import CrmDateTimePicker from "./CrmDateTimePicker";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";

const OPERATIONAL_TZ = DEFAULT_OPERATIONAL_TZ;

export type ScheduleSessionPayload = {
  therapyPackageId: string;
  sessionNumber: number;
  scheduledAt: string;
  meetUrl?: string;
  contactTimezone?: string;
  contactName?: string;
  productTitle?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onScheduled?: () => void;
  therapyPackageId: string;
  sessionNumber: number;
  meetDefaultUrl?: string | null;
  contactTimezone?: string;
  contactName?: string;
  productTitle?: string;
  initialScheduledAt?: string;
};

const toLocalInput = (iso: string | null | undefined, tz: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${getDateKeyInTz(d, tz)}T${getTimeHmInTz(d, tz)}`;
};

/** `datetime-local` value (YYYY-MM-DDTHH:mm) interpreted in `tz` → UTC ISO. */
const localInputToUtcIso = (localValue: string, tz: string): string => {
  const [dateKey, timePart] = localValue.split("T");
  if (!dateKey || !timePart) throw new Error("INVALID_ZONED_DATETIME");
  const timeHm = timePart.slice(0, 5);
  return zonedDateTimeToUtc(dateKey, timeHm, tz).toISOString();
};

const ScheduleSessionModal = ({
  open,
  onClose,
  onScheduled,
  therapyPackageId,
  sessionNumber,
  meetDefaultUrl,
  contactTimezone = OPERATIONAL_TZ,
  contactName,
  productTitle,
  initialScheduledAt,
}: Props) => {
  const { toast } = useCrm();
  const [scheduledAt, setScheduledAt] = useState("");
  const [meetUrl, setMeetUrl] = useState(meetDefaultUrl ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setScheduledAt(
        initialScheduledAt
          ? toLocalInput(initialScheduledAt, contactTimezone)
          : ""
      );
      setMeetUrl(meetDefaultUrl ?? "");
    }
  }, [open, initialScheduledAt, contactTimezone, meetDefaultUrl]);

  const submit = async () => {
    if (!scheduledAt) return;
    setBusy(true);
    let scheduledAtIso: string;
    try {
      scheduledAtIso = localInputToUtcIso(scheduledAt, contactTimezone);
    } catch {
      setBusy(false);
      toast("Fecha u hora inválida", "error");
      return;
    }
    const res = await fetch("/api/admin/therapy/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        therapyPackageId,
        sessionNumber,
        scheduledAt: scheduledAtIso,
        meetUrl: meetUrl || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      toast("Sesión agendada");
      onClose();
      onScheduled?.();
    } else {
      const d = (await res.json()) as { error?: string };
      toast(d.error ?? "Error al agendar", "error");
    }
  };

  return (
    <CrmModal
      open={open}
      onClose={onClose}
      title={`Agendar sesión ${sessionNumber}`}
    >
      <div className="space-y-4 text-sm">
        {(contactName || productTitle) && (
          <p className="text-muted-foreground">
            {contactName}
            {productTitle && <> · {productTitle}</>}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="sched-at">Fecha y hora</Label>
          <CrmDateTimePicker
            id="sched-at"
            value={scheduledAt}
            onChange={setScheduledAt}
            disabled={busy}
          />
          <p className="text-[10px] text-muted-foreground">
            Zona del contacto: {contactTimezone}. Las sesiones se agendan aquí;
            Dayana usa Google Calendar para la vista semanal.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sched-meet">Link Meet</Label>
          <Input
            id="sched-meet"
            value={meetUrl}
            onChange={(e) => setMeetUrl(e.target.value)}
            placeholder="https://meet.google.com/..."
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy || !scheduledAt} onClick={() => void submit()}>
            {busy ? "Agendando…" : "Agendar"}
          </Button>
        </div>
      </div>
    </CrmModal>
  );
};

export default ScheduleSessionModal;

export { toLocalInput, OPERATIONAL_TZ };
