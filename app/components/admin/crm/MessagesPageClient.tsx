"use client";

import { Copy, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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

const MessagesPageClient = ({ preview, initialTemplates }: Props) => {
  const { canManageTeam, toast, confirm } = useCrm();
  const [templates, setTemplates] = useState<Template[]>(initialTemplates ?? []);
  const [loading, setLoading] = useState(initialTemplates === undefined);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({ title: "", body: "" });

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

        <div className="space-y-4">
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
            <article key={t.id} className="crm-surface-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">{t.title}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="crm-btn-ghost inline-flex items-center gap-1 text-xs"
                    onClick={() => void copyBody(t.body)}
                  >
                    <Copy className="size-3.5" />
                    Copiar
                  </button>
                  {canManageTeam && !preview && (
                    <>
                      <button
                        type="button"
                        className="crm-btn-ghost text-xs"
                        onClick={() => {
                          setEditing(t);
                          setForm({ title: t.title, body: t.body });
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="crm-btn-ghost inline-flex items-center gap-1 text-xs text-red-700"
                        onClick={() => remove(t)}
                      >
                        <Trash2 className="size-3.5" />
                        Borrar
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--crm-muted)]">
                {t.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </CrmPageShell>
  );
};

export default MessagesPageClient;
