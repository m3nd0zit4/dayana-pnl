"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Input } from "@/app/components/ui/input";
import CrmModal from "../crm/CrmModal";
import { useCrm } from "../crm/CrmProvider";

export type CommunityFormValue = {
  id?: string;
  name: string;
  kind: "community" | "group";
  parentId: string | null;
  inviteLink: string | null;
  description: string | null;
};

const EMPTY: CommunityFormValue = { name: "", kind: "group", parentId: null, inviteLink: "", description: "" };

const field = "w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-[#00a884]";

/** Crear o editar una comunidad / grupo de WhatsApp. Se monta con `key` para empezar limpio cada vez. */
const CommunityFormDialog = ({
  open,
  onClose,
  initial,
  parents,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial?: CommunityFormValue | null;
  /** Comunidades que pueden contener un grupo. */
  parents: { id: string; name: string }[];
  onSaved: (saved: { id: string }) => void;
}) => {
  const { toast } = useCrm();
  const [value, setValue] = useState<CommunityFormValue>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof CommunityFormValue>(k: K, v: CommunityFormValue[K]) => setValue((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        value.id ? `/api/admin/whatsapp/communities/${value.id}` : "/api/admin/whatsapp/communities",
        {
          method: value.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: value.name,
            kind: value.kind,
            parentId: value.kind === "group" ? value.parentId || null : null,
            inviteLink: value.inviteLink?.trim() || null,
            description: value.description?.trim() || null,
          }),
        }
      );
      if (!res.ok) throw new Error();
      const saved = (await res.json()) as { id: string };
      toast(value.id ? "Guardado" : "Comunidad creada", "success");
      onSaved(saved);
      onClose();
    } catch {
      toast("No se pudo guardar. Revisa el nombre y que el enlace empiece por https://", "error");
    } finally {
      setSaving(false);
    }
  };

  const options = parents.filter((p) => p.id !== value.id);

  return (
    <CrmModal title={value.id ? "Editar" : "Nueva comunidad"} open={open} onClose={() => !saving && onClose()}>
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Nombre</span>
          <Input value={value.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} placeholder="Mujeres que sanan" />
        </label>
        <div className="flex gap-1.5">
          {(["group", "community"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => set("kind", k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${value.kind === k ? "bg-[#00a884] text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
            >
              {k === "group" ? "Grupo" : "Comunidad"}
            </button>
          ))}
        </div>
        {value.kind === "group" && options.length > 0 && (
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Dentro de la comunidad (opcional)</span>
            <select value={value.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || null)} className={field}>
              <option value="">— Ninguna —</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Enlace de invitación (Info del grupo → Invitar con enlace)</span>
          <Input
            value={value.inviteLink ?? ""}
            onChange={(e) => set("inviteLink", e.target.value)}
            type="url"
            inputMode="url"
            placeholder="https://chat.whatsapp.com/…"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Descripción (opcional)</span>
          <textarea
            value={value.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            maxLength={2000}
            className={field}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-full px-4 text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !value.name.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-4 font-medium text-white hover:bg-[#008069] disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />} Guardar
          </button>
        </div>
      </form>
    </CrmModal>
  );
};

export default CommunityFormDialog;
