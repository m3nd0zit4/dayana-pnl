"use client";

import { useEffect, useState } from "react";
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
      onScheduled?.();
      onClose();
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
          <p className="text-[var(--crm-muted)]">
            {contactName}
            {productTitle && <> · {productTitle}</>}
          </p>
        )}
        <div>
          <label className="crm-label" htmlFor="sched-at">
            Fecha y hora
          </label>
          <input
            id="sched-at"
            type="datetime-local"
            className="crm-input mt-1"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          <p className="mt-1 text-[10px] text-[var(--crm-muted)]">
            Zona del contacto: {contactTimezone}. El calendario interno usa{" "}
            {OPERATIONAL_TZ}.
          </p>
        </div>
        <div>
          <label className="crm-label" htmlFor="sched-meet">
            Link Meet
          </label>
          <input
            id="sched-meet"
            className="crm-input mt-1"
            value={meetUrl}
            onChange={(e) => setMeetUrl(e.target.value)}
            placeholder="https://meet.google.com/..."
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="crm-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="crm-btn-primary"
            disabled={busy || !scheduledAt}
            onClick={() => void submit()}
          >
            {busy ? "Agendando…" : "Agendar"}
          </button>
        </div>
      </div>
    </CrmModal>
  );
};

export default ScheduleSessionModal;

export { toLocalInput, OPERATIONAL_TZ };
