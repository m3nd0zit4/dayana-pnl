"use client";

import { useState } from "react";
import { Bot, Copy, KeyRound, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import CrmModal from "@/app/components/admin/crm/CrmModal";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import {
  CrmDataList,
  CrmDataListHeader,
  CrmDataListRow,
  CrmEmptyState,
  CrmField,
  CrmFormActions,
  CrmRowActions,
  CrmRowDelete,
} from "@/app/components/admin/crm/ui";
import { MCP_SCOPES, SCOPE_LABELS, type McpScope } from "@/lib/mcp/scopes";
import type { McpTokenView } from "@/lib/mcp/tokens";

type Props = {
  initialTokens: McpTokenView[];
  allowedScopes: McpScope[];
  viewerId: string;
  isOwner: boolean;
  /** `https://www.dayanabeltran.com/api/mcp` en producción. */
  endpoint: string;
};

const EXPIRY = [
  { value: "30", label: "30 días" },
  { value: "90", label: "90 días" },
  { value: "365", label: "1 año" },
  { value: "never", label: "Sin caducidad" },
] as const;
type ExpiryValue = (typeof EXPIRY)[number]["value"];

const STATUS_LABEL: Record<McpTokenView["status"], string> = {
  active: "Activa",
  revoked: "Revocada",
  expired: "Caducada",
};

const dateLabel = (iso: string | null, empty = "—") =>
  iso
    ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso))
    : empty;

const snippets = (endpoint: string, token: string) => [
  {
    id: "claude-code",
    title: "Claude Code",
    hint: "Pégalo en una terminal.",
    text: `claude mcp add --transport http dayana-crm ${endpoint} --header "Authorization: Bearer ${token}"`,
  },
  {
    id: "claude-desktop",
    title: "Claude Desktop",
    hint: "En claude_desktop_config.json (Ajustes → Desarrollador → Editar configuración). Necesita Node.js.",
    text: JSON.stringify(
      {
        mcpServers: {
          "dayana-crm": {
            command: "npx",
            args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${AUTH_HEADER}"],
            env: { AUTH_HEADER: `Bearer ${token}` },
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "cursor",
    title: "Cursor y otros clientes",
    hint: "En .cursor/mcp.json o la configuración MCP del cliente (Streamable HTTP).",
    text: JSON.stringify(
      { mcpServers: { "dayana-crm": { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } },
      null,
      2
    ),
  },
];

const McpTokensClient = ({ initialTokens, allowedScopes, viewerId, isOwner, endpoint }: Props) => {
  const { toast, confirm } = useCrm();
  const [tokens, setTokens] = useState(initialTokens);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpScope[]>(allowedScopes);
  const [expiry, setExpiry] = useState<ExpiryValue>("90");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);

  const canCreate = allowedScopes.length > 0;

  const openCreate = () => {
    setName("");
    setScopes(allowedScopes);
    setExpiry("90");
    setError(null);
    setCreated(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setCreated(null);
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copiado.`);
    } catch {
      toast("No se pudo copiar. Selecciónalo y cópialo a mano.", "error");
    }
  };

  const create = async () => {
    if (!name.trim()) {
      setError("Ponle un nombre para reconocerla, p. ej. «Claude en mi portátil».");
      return;
    }
    if (scopes.length === 0) {
      setError("Elige al menos un permiso.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          expiresInDays: expiry === "never" ? null : Number(expiry),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        record?: McpTokenView;
        detail?: string;
      };
      if (!res.ok || !data.token || !data.record) {
        setError(data.detail ?? "No se pudo crear la conexión.");
        return;
      }
      setTokens((prev) => [data.record as McpTokenView, ...prev]);
      setCreated({ token: data.token, name: data.record.name });
      toast("Conexión creada.");
    } catch {
      setError("No se pudo contactar con el servidor.");
    } finally {
      setSaving(false);
    }
  };

  const revoke = (token: McpTokenView) =>
    confirm({
      title: "Revocar conexión",
      message: `«${token.name}» dejará de funcionar al instante en todos los clientes que la usen. No se puede deshacer: para volver a conectar crea otra.`,
      confirmLabel: "Revocar",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/mcp-tokens/${token.id}`, { method: "DELETE" });
        const data = (await res.json().catch(() => ({}))) as { record?: McpTokenView; detail?: string };
        if (!res.ok || !data.record) {
          toast(data.detail ?? "No se pudo revocar la conexión.", "error");
          return;
        }
        setTokens((prev) => prev.map((t) => (t.id === token.id ? (data.record as McpTokenView) : t)));
        toast("Conexión revocada.");
      },
    });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Agentes externos (MCP)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecta Claude, Cursor u otro agente al CRM con un token personal. Cada conexión
            puede como mucho lo que permite tu rol, y si tu rol cambia, cambia con él. Todo lo que
            un agente modifica queda en Auditoría con el nombre de la conexión.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            En claude.ai no hace falta token: en Conectores, «Añadir conector personalizado» con{" "}
            <span className="font-mono break-all">{endpoint}</span>, e inicias sesión con tu cuenta del CRM.
            Esas conexiones también aparecen aquí y se revocan igual.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={openCreate} className="shrink-0">
            <Plus aria-hidden />
            Nueva conexión
          </Button>
        )}
      </div>

      {!canCreate && (
        <Alert>
          <KeyRound className="size-4" />
          <AlertTitle>Tu rol no tiene acceso por MCP</AlertTitle>
          <AlertDescription>Pide a la dueña un rol de lectura u operación si lo necesitas.</AlertDescription>
        </Alert>
      )}

      {tokens.length === 0 ? (
        <CrmEmptyState
          icon={Bot}
          title="Ninguna conexión todavía"
          description="Crea una para usar el CRM desde Claude Code, Claude Desktop, Cursor u otro cliente MCP."
        />
      ) : (
        <CrmDataList>
          <CrmDataListHeader>
            <span className="flex-1">Conexión</span>
            <span className="lg:w-44">Permisos</span>
            <span className="lg:w-28">Creada</span>
            <span className="lg:w-28">Último uso</span>
            <span className="lg:w-28">Caduca</span>
            <span className="lg:w-24">Estado</span>
            <span className="lg:w-7" />
          </CrmDataListHeader>
          {tokens.map((t) => {
            const canRevoke = t.status === "active" && (t.staffUserId === viewerId || isOwner);
            return (
              <CrmDataListRow
                key={t.id}
                actions={
                  canRevoke ? (
                    <CrmRowActions>
                      <CrmRowDelete label="Revocar" onClick={() => revoke(t)} />
                    </CrmRowActions>
                  ) : undefined
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.kind === "oauth" ? (
                      <span>Inicio de sesión (OAuth)</span>
                    ) : (
                      <span className="font-mono">{t.prefix}…</span>
                    )}
                    {isOwner && t.staffUserId !== viewerId ? ` · ${t.ownerName}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 lg:w-44">
                  {t.scopes.map((s) => (
                    <Badge key={s} variant="secondary">
                      {SCOPE_LABELS[s].label}
                    </Badge>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground lg:w-28">
                  <span className="lg:hidden">Creada </span>
                  {dateLabel(t.createdAt)}
                </span>
                <span className="text-xs text-muted-foreground lg:w-28">
                  <span className="lg:hidden">Último uso </span>
                  {dateLabel(t.lastUsedAt, "Nunca")}
                </span>
                <span className="text-xs text-muted-foreground lg:w-28">
                  <span className="lg:hidden">Caduca </span>
                  {dateLabel(t.expiresAt, "Nunca")}
                </span>
                <span className="lg:w-24">
                  <Badge variant={t.status === "active" ? "default" : "outline"}>{STATUS_LABEL[t.status]}</Badge>
                </span>
              </CrmDataListRow>
            );
          })}
        </CrmDataList>
      )}

      <CrmModal title={created ? "Tu token" : "Nueva conexión"} open={open} onClose={close} large={Boolean(created)}>
        {created ? (
          <div className="space-y-4">
            <Alert variant="warning">
              <KeyRound className="size-4" />
              <AlertTitle>Cópialo ahora: no se vuelve a mostrar</AlertTitle>
              <AlertDescription>
                Es como una contraseña de «{created.name}». Si se pierde o alguien más lo ve, revócalo y
                crea otro.
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Input readOnly value={created.token} className="font-mono text-xs" aria-label="Token" />
              <Button variant="outline" size="sm" onClick={() => copy(created.token, "Token")}>
                <Copy aria-hidden />
                Copiar
              </Button>
            </div>
            {snippets(endpoint, created.token).map((s) => (
              <div key={s.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{s.title}</p>
                  <Button variant="ghost" size="sm" onClick={() => copy(s.text, s.title)}>
                    <Copy aria-hidden />
                    Copiar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{s.hint}</p>
                <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre">
                  {s.text}
                </pre>
              </div>
            ))}
            <CrmFormActions size="sm">
              <Button onClick={close}>Listo</Button>
            </CrmFormActions>
          </div>
        ) : (
          <div className="space-y-4">
            <CrmField label="Nombre" description="Para reconocerla en la lista: «Claude en mi portátil», «Cursor».">
              <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </CrmField>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Permisos</legend>
              {MCP_SCOPES.map((scope) => {
                const allowed = allowedScopes.includes(scope);
                return (
                  <label
                    key={scope}
                    className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm has-[:disabled]:opacity-60"
                  >
                    <Checkbox
                      checked={scopes.includes(scope)}
                      disabled={!allowed}
                      onCheckedChange={(next) =>
                        setScopes((prev) =>
                          next ? MCP_SCOPES.filter((s) => s === scope || prev.includes(s)) : prev.filter((s) => s !== scope)
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{SCOPE_LABELS[scope].label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {SCOPE_LABELS[scope].description}
                        {!allowed ? " Tu rol no lo permite." : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <CrmField label="Caduca">
              <Select value={expiry} onValueChange={(v) => setExpiry((typeof v === "string" ? v : "90") as ExpiryValue)}>
                <SelectTrigger aria-label="Caducidad" className="w-full">
                  <SelectValue>{(value) => EXPIRY.find((o) => o.value === value)?.label ?? "90 días"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CrmField>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <CrmFormActions size="sm">
              <Button variant="outline" onClick={close} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={create} disabled={saving}>
                {saving ? "Creando…" : "Crear conexión"}
              </Button>
            </CrmFormActions>
          </div>
        )}
      </CrmModal>
    </div>
  );
};

export default McpTokensClient;
