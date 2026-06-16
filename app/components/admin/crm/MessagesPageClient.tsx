"use client";

import { ChevronDown, Copy, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { isQuickMessageTemplate } from "@/lib/crm/quick-message-templates";
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
    <article className="crm-surface-card overflow-hidden">
      <div className="flex items-start gap-2 p-4 sm:p-5">
        <button
          type="button"
          className="mt-0.5 flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-[var(--crm-muted)] transition-colors hover:bg-black/[0.04] hover:text-[var(--crm-foreground)]"
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
              <span className="mt-1 block truncate text-xs text-[var(--crm-muted)]">
                {template.body.replace(/\s+/g, " ").trim()}
              </span>
            ) : null}
          </button>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5 sm:gap-2">
          <button
            type="button"
            className="crm-btn-ghost inline-flex items-center gap-1 text-xs"
            onClick={onCopy}
          >
            <Copy className="size-3.5" />
            <span className="hidden sm:inline">Copiar</span>
          </button>
          {canManageTeam && !preview && (
            <>
              <button type="button" className="crm-btn-ghost text-xs" onClick={onEdit}>
                Editar
              </button>
              <button
                type="button"
                className="crm-btn-ghost inline-flex items-center gap-1 text-xs text-red-700"
                onClick={onRemove}
              >
                <Trash2 className="size-3.5" />
                <span className="hidden sm:inline">Borrar</span>
              </button>
            </>
          )}
        </div>
      </div>
      {expanded ? (
        <div id={bodyId} className="border-t border-[var(--crm-border)] px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--crm-muted)]">
            {template.body}
          </p>
        </div>
      ) : null}
    </article>
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
            <h1 className="crm-section-title text-xl">Mensajes rápidos</h1>
            <p className="crm-section-subtitle mt-1 max-w-xl">
              Tus textos personalizados para copiar y pegar en WhatsApp. En la ficha
              del contacto el nombre se sustituye solo al copiar.
            </p>
          </div>
          {canManageTeam && !preview && (
            <button type="button" className="crm-btn-primary crm-btn-compact" onClick={startNew}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nuevo mensaje</span>
            </button>
          )}
        </div>

        {editing && canManageTeam && (
          <div className="crm-surface-card space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-[var(--crm-accent)]" />
              <h2 className="text-sm font-semibold">
                {editing.id ? "Editar mensaje" : "Nuevo mensaje"}
              </h2>
            </div>

            <div>
              <label className="crm-label" htmlFor="msg-title">
                Cómo lo identificas tú
              </label>
              <input
                id="msg-title"
                className="crm-input mt-1"
                placeholder="Seguimiento después del taller"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div>
              <label className="crm-label" htmlFor="msg-body">
                Texto para WhatsApp
              </label>
              <textarea
                id="msg-body"
                className="crm-textarea mt-1 min-h-[160px] text-sm leading-relaxed"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {VARIABLE_HINTS.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    className="rounded-full border border-[var(--crm-border)] bg-[var(--crm-linen)]/30 px-3 py-1 text-[11px] text-[var(--crm-muted)] transition hover:border-[var(--crm-accent)] hover:text-[var(--crm-foreground)]"
                    onClick={() => insertToken(v.token)}
                  >
                    + {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" className="crm-btn-primary" onClick={() => void save()}>
                Guardar
              </button>
              <button
                type="button"
                className="crm-btn-secondary"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {loading && (
            <p className="text-sm text-[var(--crm-muted)]">Cargando…</p>
          )}
          {!loading && templates.length === 0 && !editing && (
            <div className="crm-surface-card p-8 text-center">
              <p className="text-sm text-[var(--crm-muted)]">
                Aún no tienes mensajes propios.
              </p>
              {canManageTeam && !preview && (
                <button
                  type="button"
                  className="crm-btn-primary mt-4"
                  onClick={startNew}
                >
                  <Plus className="size-4" />
                  Crear el primero
                </button>
              )}
            </div>
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
