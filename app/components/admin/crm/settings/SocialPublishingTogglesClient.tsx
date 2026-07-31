"use client";

import { useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent } from "@/app/components/ui/card";
import { Switch } from "@/app/components/ui/switch";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";

export type SocialPublishingTogglesProps = {
  /** Efectivo (override de BD, o entorno si no hay fila). */
  publishingEnabled: boolean;
  publishingOverride: boolean | null;
  audited: boolean;
  auditedOverride: boolean | null;
};

type PatchBody = {
  socialPublishingEnabled?: boolean | null;
  tiktokAudited?: boolean | null;
};

const SocialPublishingTogglesClient = ({
  publishingEnabled,
  publishingOverride,
  audited,
  auditedOverride,
}: SocialPublishingTogglesProps) => {
  const { toast } = useCrm();
  const [busy, setBusy] = useState(false);
  const [enabledEffective, setEnabledEffective] = useState(publishingEnabled);
  const [enabledOverride, setEnabledOverride] = useState(publishingOverride);
  const [auditedEffective, setAuditedEffective] = useState(audited);
  const [auditedOverrideState, setAuditedOverrideState] = useState(auditedOverride);

  const patch = async (
    body: PatchBody,
    onOk: () => void,
    successMsg: string
  ) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings/social-content", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast("No se pudo actualizar la publicación en redes.", "error");
        return;
      }
      onOk();
      toast(successMsg);
    } catch {
      toast("No se pudo contactar con el servidor.", "error");
    } finally {
      setBusy(false);
    }
  };

  const setPublishing = (value: boolean | null) =>
    patch(
      { socialPublishingEnabled: value },
      () => {
        setEnabledOverride(value);
        setEnabledEffective(value == null ? publishingEnabled : value);
      },
      value == null
        ? "Publicación: vuelto a automático (entorno)."
        : value
          ? "Publicación en redes activada."
          : "Publicación en redes desactivada."
    );

  const setAudited = (value: boolean | null) =>
    patch(
      { tiktokAudited: value },
      () => {
        setAuditedOverrideState(value);
        setAuditedEffective(value == null ? audited : value);
      },
      value == null
        ? "Auditoría de TikTok: vuelto a automático (entorno)."
        : value
          ? "TikTok marcado como auditado."
          : "TikTok marcado como no auditado."
    );

  return (
    <Card>
      <CardContent className="space-y-5">
        <div>
          <h3 className="text-sm font-medium">Publicación en redes</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Controla si <code>/admin/contenido</code> y sus rutas de API están
            activas, sin tocar <code>SOCIAL_PUBLISHING_ENABLED</code>. Sigue
            exigiendo credenciales reales de TikTok — el interruptor no
            &quot;inventa&quot; una conexión que no existe.
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm">Publicación en redes activada</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={enabledOverride == null ? "secondary" : "default"}>
              {enabledOverride == null ? "Automático (entorno)" : "Override manual"}
            </Badge>
            <Switch
              checked={enabledEffective}
              disabled={busy}
              onCheckedChange={(next) => void setPublishing(Boolean(next))}
            />
          </div>
        </div>
        {enabledOverride != null && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            disabled={busy}
            onClick={() => void setPublishing(null)}
          >
            Restablecer a automático
          </button>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm">TikTok auditado</p>
            <p className="text-xs text-muted-foreground">
              Sin auditar, toda publicación se fuerza a privado (
              <code>SELF_ONLY</code>).
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={auditedOverrideState == null ? "secondary" : "default"}>
              {auditedOverrideState == null ? "Automático (entorno)" : "Override manual"}
            </Badge>
            <Switch
              checked={auditedEffective}
              disabled={busy}
              onCheckedChange={(next) => void setAudited(Boolean(next))}
            />
          </div>
        </div>
        {auditedOverrideState != null && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            disabled={busy}
            onClick={() => void setAudited(null)}
          >
            Restablecer a automático
          </button>
        )}
      </CardContent>
    </Card>
  );
};

export default SocialPublishingTogglesClient;
