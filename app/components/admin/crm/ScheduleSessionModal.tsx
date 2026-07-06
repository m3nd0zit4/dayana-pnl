"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import CrmDateTimePicker from "./CrmDateTimePicker";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";

const OPERATIONAL_TZ = "America/Bogota";

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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
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
    const res = await fetch("/api/admin/therapy/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        therapyPackageId,
        sessionNumber,
        scheduledAt: new Date(scheduledAt).toISOString(),
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
