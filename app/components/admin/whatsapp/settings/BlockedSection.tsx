"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { useCrm } from "../../crm/CrmProvider";
import { useSettings } from "./context";
import SettingRow from "./SettingRow";

const API = "/api/admin/whatsapp/blocked";

type Row = {
  phoneHash: string;
  reason: string;
  source: string;
  detail: string | null;
  apiBlockedAt: string | null;
  apiError: string | null;
  actions: { noticeSent?: boolean; apiAccepted?: boolean; deletedChats?: number; deletedMessages?: number; hiddenChats?: number } | null;
  blockedAt: string;
  unblockedAt: string | null;
};

const REASON: Record<string, string> = {
  app: "Lo bloqueaste en tu WhatsApp",
  sexual_content: "Contenido sexual",
  manual: "Bloqueado desde el CRM",
};

const date = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * «Números bloqueados»: lo que salió del CRM porque está bloqueado en WhatsApp
 * (sin el número: solo una huella). Los de contenido sexual recuerdan que
 * reportarlos solo se puede desde la app del celular.
 */
const BlockedSection = () => {
  const { preview } = useSettings();
  const { toast } = useCrm();
  const [rows, setRows] = useState<Row[] | null>(preview ? [] : null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (preview) return;
    const res = await fetch(API).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { rows?: Row[] } | null;
    setRows(data?.rows ?? []);
  }, [preview]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const sync = async () => {
    setBusy(true);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { result?: { listed: number; added: number; removed: number }; message?: string } | null;
      if (!res?.ok || !data?.result) {
        toast(`No se pudo leer la lista de WhatsApp${data?.message ? `: ${data.message}` : "."}`, "error");
        return;
      }
      const r = data.result;
      toast(`WhatsApp tiene ${r.listed} bloqueados · ${r.added} nuevos fuera del CRM · ${r.removed} desbloqueados`, "success");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const active = (rows ?? []).filter((r) => !r.unblockedAt);

  return (
    <SettingRow
      id="wa-blocked"
      layout="stacked"
      label="Números bloqueados"
      help="Un número que bloqueas en tu WhatsApp sale del CRM (se revisa cada 30 min) y vuelve si lo desbloqueas. Quien manda contenido sexual recibe un aviso, se bloquea y su chat se borra. Reportarlo a WhatsApp solo se puede desde tu app: abre el chat → toca el nombre → «Reportar»."
    >
      <div className="space-y-3">
        <Button type="button" variant="outline" size="sm" onClick={sync} disabled={busy || preview}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          Revisar la lista de WhatsApp ahora
        </Button>
        {rows === null ? (
          <p className="text-xs text-muted-foreground">Cargando…</p>
        ) : active.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay números bloqueados.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {active.map((r) => (
              <li key={r.phoneHash} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-medium">{REASON[r.reason] ?? r.reason}</span>
                <span className="text-xs text-muted-foreground">{date(r.blockedAt)}</span>
                {r.reason === "sexual_content" && <Badge variant="destructive">Falta reportarlo desde tu app</Badge>}
                {r.reason !== "app" && !r.actions?.apiAccepted && !r.apiBlockedAt && (
                  <Badge variant="outline">WhatsApp no aceptó el bloqueo: bloquéalo en tu app</Badge>
                )}
                {r.actions?.deletedChats ? (
                  <span className="text-xs text-muted-foreground">chat borrado ({r.actions.deletedMessages ?? 0} mensajes)</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingRow>
  );
};

export default BlockedSection;
