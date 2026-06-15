"use client";

import { useState } from "react";
import CrmModal from "./CrmModal";
import SearchableSelect from "./SearchableSelect";
import { useCrm } from "./CrmProvider";

type Props = {
  open: boolean;
  workshopEditionId?: string;
  workshopTitle?: string;
  onClose: () => void;
};

const BroadcastNotifyModal = ({
  open,
  workshopEditionId,
  workshopTitle,
  onClose,
}: Props) => {
  const { toast, dismissToast, confirm } = useCrm();
  const [audience, setAudience] = useState<"ALL_CONTACTS" | "MARKETING_CONSENT">(
    "ALL_CONTACTS"
  );
  const [loading, setLoading] = useState(false);

  const audienceLabel =
    audience === "MARKETING_CONSENT"
      ? "contactos con consentimiento de marketing"
      : "todos los contactos con correo";

  const handleSend = () => {
    confirm({
      title: "Enviar aviso por correo",
      message: `Se enviará el aviso del taller a ${audienceLabel}. Si la lista es grande (cientos o miles de contactos), el envío se procesará en segundo plano y puede tardar varios minutos. ¿Continuar?`,
      onConfirm: async () => {
        const editionId = workshopEditionId;
        const title = workshopTitle;
        const audienceValue = audience;

        setLoading(true);
        onClose();

        const loadingToastId = toast({
          title: "En proceso",
          message: "Preparando y encolando la campaña…",
          variant: "loading",
        });
        try {
          const res = await fetch("/api/admin/notifications/broadcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: title ? `Taller: ${title}` : "Campaña CRM",
              templateKey: "workshop_open",
              channels: ["EMAIL"],
              audience: audienceValue,
              workshopEditionId: editionId,
              runNow: true,
            }),
          });
          const data = await res.json().catch(() => ({}));
          dismissToast(loadingToastId);

          if (!res.ok) {
            if (data.error === "channels_not_configured") {
              toast({
                title: "Faltan credenciales",
                message: `Configura: ${(data.missing ?? []).join(", ")}`,
                variant: "error",
              });
            } else if (data.error === "inngest_required") {
              toast({
                title: "Lista demasiado grande",
                message:
                  data.hint ??
                  "Para enviar a muchos contactos necesitas Inngest (INNGEST_EVENT_KEY).",
                variant: "error",
                duration: 10000,
              });
            } else if (data.error === "notifications_disabled") {
              toast({
                title: "Notificaciones desactivadas",
                message: data.hint ?? "Activa NOTIFICATIONS_ENABLED en el servidor.",
                variant: "error",
              });
            } else {
              toast({
                title: "No se pudo enviar",
                message: String(data.error ?? "Error desconocido"),
                variant: "error",
              });
            }
            return;
          }

          const count = Number(data.contactCount ?? 0);
          const countLabel = `${count} contacto${count === 1 ? "" : "s"}`;

          if (data.queued) {
            toast({
              title: "Campaña en cola",
              message: `${countLabel} — se procesará en segundo plano. Puede tardar varios minutos.`,
              variant: "info",
              duration: 12000,
              action: { label: "Ver progreso en Notificaciones", href: "/admin/notifications" },
            });
          } else {
            toast({
              title: "Campaña completada",
              message: `Correos enviados a ${countLabel}.`,
              variant: "success",
            });
          }
        } finally {
          dismissToast(loadingToastId);
          setLoading(false);
        }
      },
    });
  };

  return (
    <CrmModal open={open} title="Notificar contactos" onClose={onClose}>
      <div className="space-y-4 text-sm">
        {workshopTitle && (
          <p className="rounded-xl bg-[var(--crm-surface)] px-3 py-2 text-[var(--crm-muted)]">
            Taller: <strong className="text-[var(--crm-ink)]">{workshopTitle}</strong>
          </p>
        )}

        <SearchableSelect
          id="broadcast-audience"
          label="Audiencia"
          value={audience}
          options={[
            { value: "ALL_CONTACTS", label: "Todos los contactos" },
            {
              value: "MARKETING_CONSENT",
              label: "Solo con consentimiento marketing",
            },
          ]}
          onChange={(v) =>
            setAudience(v as "ALL_CONTACTS" | "MARKETING_CONSENT")
          }
          disabled={loading}
          searchMinOptions={99}
        />

        <p className="text-[11px] leading-relaxed text-[var(--crm-muted)]">
          Cada contacto con correo recibirá el aviso con el diseño de la marca.
          Listas grandes se envían en lotes en segundo plano — revisa el progreso
          en{" "}
          <span className="text-[var(--crm-accent)]">Notificaciones</span>.
        </p>

        <p className="rounded-lg border border-sky-200/80 bg-sky-50/80 px-3 py-2 text-[11px] leading-relaxed text-sky-900">
          Si tienes cientos o miles de contactos, el envío puede tardar varios
          minutos. Verás el aviso «En cola» y podrás seguir el progreso sin
          esperar en esta pantalla.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className="crm-btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="crm-btn-primary"
            disabled={loading}
            onClick={handleSend}
          >
            {loading ? "Enviando…" : "Enviar campaña"}
          </button>
        </div>
      </div>
    </CrmModal>
  );
};

export default BroadcastNotifyModal;
