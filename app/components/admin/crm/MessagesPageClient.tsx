"use client";

import { ChevronDown, Copy, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { isQuickMessageTemplate } from "@/lib/crm/quick-message-templates";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";

type Template = {
  id: string;
  key: string;
  title: string;
  body: string;
};

type Props = {
  preview: boolean;
  initialTemplates?: Template[];
};

const VARIABLE_HINTS = [
  { token: "{{first_name}}", label: "nombre" },
  { token: "{{product_title}}", label: "producto" },
] as const;

const MessageTemplateCard = ({
  template,
  expanded,
  onToggle,
  canManageTeam,
  preview,
  onCopy,
  onEdit,
  onRemove,
}: {
  template: Template;
  expanded: boolean;
  onToggle: () => void;
  canManageTeam: boolean;
  preview: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) => {
  const bodyId = useId();

  return (
    <Card className="overflow-hidden py-0">
      <div className="flex items-start gap-2 p-4 sm:p-5">
        <button
          type="button"
          className="mt-0.5 flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={expanded ? "Ocultar texto" : "Ver texto"}
          onClick={onToggle}
        >
          <ChevronDown
            className={`size-4 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="w-full text-left"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggle}
          >
            <span className="text-sm font-semibold leading-snug">{template.title}</span>
            {!expanded ? (
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {template.body.replace(/\s+/g, " ").trim()}
              </span>
            ) : null}
          </button>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onCopy}>
            <Copy />
            <span className="hidden sm:inline">Copiar</span>
          </Button>
          {canManageTeam && !preview && (
            <>
              <Button variant="ghost" size="sm" onClick={onEdit}>
                Editar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={onRemove}
              >
                <Trash2 />
                <span className="hidden sm:inline">Borrar</span>
              </Button>
            </>
          )}
        </div>
      </div>
      {expanded ? (
        <div id={bodyId} className="border-t border-border px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {template.body}
          </p>
        </div>
      ) : null}
    </Card>
  );
};

const MessagesPageClient = ({ preview, initialTemplates }: Props) => {
  const { canManageTeam, toast, confirm } = useCrm();
  const [templates, setTemplates] = useState<Template[]>(initialTemplates ?? []);
  const [loading, setLoading] = useState(initialTemplates === undefined);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({ title: "", body: "" });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const load = () => {
    if (preview) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/admin/messages/templates")
      .then(async (r) => {
        if (!r.ok) throw new Error("load_failed");
        return r.json();
      })
      .then((d) =>
        setTemplates(
          (d.templates ?? [])
            .filter((t: { key: string }) => isQuickMessageTemplate(t.key))
            .map(
              (t: {
                id: string;
                title?: string;
                key: string;
                body: string;
              }) => ({
                id: t.id,
                key: t.key,
                title: t.title?.trim() || t.key.replace(/-/g, " "),
                body: t.body,
              })
            )
        )
      )
      .catch(() => toast("Error al cargar mensajes", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (initialTemplates !== undefined) return;
    load();
  }, [preview, initialTemplates]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyBody = async (body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      toast("Texto copiado — pégalo en WhatsApp");
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  const insertToken = (token: string) => {
    setForm((f) => ({
      ...f,
      body: f.body ? `${f.body}${f.body.endsWith(" ") ? "" : " "}${token}` : token,
    }));
  };

  const startNew = () => {
    setEditing({ id: "", key: "", title: "", body: "" });
    setForm({
      title: "",
      body: "Hola {{first_name}},\n\n",
    });
  };

  const save = async () => {
    if (!canManageTeam) return;
    if (!form.title.trim() || !form.body.trim()) {
      toast("Nombre y texto son obligatorios", "error");
      return;
    }
    const isNew = !editing?.id;
    const res = await fetch("/api/admin/messages/templates", {
      method: isNew ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        isNew
          ? { title: form.title.trim(), body: form.body.trim() }
          : { id: editing!.id, title: form.title.trim(), body: form.body.trim() }
      ),
    });
    if (res.ok) {
      toast(isNew ? "Mensaje creado" : "Mensaje guardado");
      setEditing(null);
      load();
    } else toast("Error al guardar", "error");
  };

  const remove = (template: Template) => {
    confirm({
      title: "Eliminar mensaje",
      message: `¿Borrar «${template.title}»? No se puede deshacer.`,
      onConfirm: async () => {
        const res = await fetch("/api/admin/messages/templates", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: template.id }),
        });
        if (!res.ok) {
          toast("No se pudo eliminar el mensaje", "error");
          return;
        }
        if (editing?.id === template.id) setEditing(null);
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(template.id);
          return next;
        });
        toast("Mensaje eliminado");
        load();
      },
    });
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Mensajes rápidos</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Tus textos personalizados para copiar y pegar en WhatsApp. En la ficha
              del contacto el nombre se sustituye solo al copiar.
            </p>
          </div>
          {canManageTeam && !preview && (
            <Button size="sm" onClick={startNew}>
              <Plus />
              <span className="hidden sm:inline">Nuevo mensaje</span>
            </Button>
          )}
        </div>

        {editing && canManageTeam && (
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">
                  {editing.id ? "Editar mensaje" : "Nuevo mensaje"}
                </h2>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="msg-title">Cómo lo identificas tú</Label>
                <Input
                  id="msg-title"
                  placeholder="Seguimiento después del taller"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="msg-body">Texto para WhatsApp</Label>
                <Textarea
                  id="msg-body"
                  className="min-h-[160px] text-sm leading-relaxed"
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {VARIABLE_HINTS.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      className="rounded-full border border-border bg-secondary/50 px-3 py-1 text-[11px] text-muted-foreground transition hover:border-primary hover:text-foreground"
                      onClick={() => insertToken(v.token)}
                    >
                      + {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button onClick={() => void save()}>Guardar</Button>
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!loading && templates.length === 0 && !editing && (
            <Card className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Aún no tienes mensajes propios.
              </p>
              {canManageTeam && !preview && (
                <Button className="mt-4" onClick={startNew}>
                  <Plus />
                  Crear el primero
                </Button>
              )}
            </Card>
          )}
          {templates.map((t) => (
            <MessageTemplateCard
              key={t.id}
              template={t}
              expanded={expandedIds.has(t.id)}
              onToggle={() => toggleExpanded(t.id)}
              canManageTeam={canManageTeam}
              preview={preview}
              onCopy={() => void copyBody(t.body)}
              onEdit={() => {
                setEditing(t);
                setForm({ title: t.title, body: t.body });
              }}
              onRemove={() => remove(t)}
            />
          ))}
        </div>
      </div>
    </CrmPageShell>
  );
};

export default MessagesPageClient;
