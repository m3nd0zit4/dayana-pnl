"use client";

import { ProductKind } from "@prisma/client";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";
import { useCrm } from "./CrmProvider";

type Product = {
  id: string;
  kind: ProductKind;
  title: string;
  sessionsLabel: string;
  sessionsCount: number | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  prices: { amountMinor: number; listAmountMinor: number | null }[];
};

const KIND_LABEL: Record<ProductKind, string> = {
  THERAPY: "Terapia 1:1",
  COURSE: "Curso",
  WORKSHOP: "Taller",
};

const emptyForm = () => ({
  kind: "THERAPY" as ProductKind,
  title: "",
  sessionsLabel: "",
  sessionsCount: "",
  amountUsd: "",
  listAmountUsd: "",
  description: "",
});

type Props = {
  preview: boolean;
  initialProducts?: Product[];
  initialUsdToCopRate?: number;
};

const ProductsPageClient = ({
  preview,
  initialProducts,
  initialUsdToCopRate = 3500,
}: Props) => {
  const { canManageTeam, toast, confirm } = useCrm();
  const [products, setProducts] = useState<Product[]>(initialProducts ?? []);
  const [loading, setLoading] = useState(initialProducts === undefined);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [usdToCopRate, setUsdToCopRate] = useState(String(initialUsdToCopRate));
  const [rateSaving, setRateSaving] = useState(false);

  const load = useCallback(() => {
    if (preview) {
      setProducts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/admin/products")
      .then((r) => r.json())
      .then((d) => setProducts(d.products ?? []))
      .catch(() => toast("Error al cargar productos", "error"))
      .finally(() => setLoading(false));
  }, [preview, toast]);

  useEffect(() => {
    if (initialProducts !== undefined) return;
    load();
  }, [initialProducts, load]);

  const openEdit = (p: Product) => {
    const price = p.prices[0];
    setEditing(p);
    setCreating(false);
    setForm({
      kind: p.kind,
      title: p.title,
      sessionsLabel: p.sessionsLabel,
      sessionsCount: p.sessionsCount?.toString() ?? "",
      amountUsd: price ? String(price.amountMinor / 100) : "",
      listAmountUsd: price?.listAmountMinor
        ? String(price.listAmountMinor / 100)
        : "",
      description: p.description ?? "",
    });
  };

  const save = async () => {
    if (!canManageTeam) return;
    const payload = {
      ...(creating ? {} : { id: editing!.id }),
      kind: form.kind,
      title: form.title,
      sessionsLabel: form.sessionsLabel || form.title,
      sessionsCount: form.sessionsCount ? Number(form.sessionsCount) : null,
      description: form.description,
      amountUsd: Number(form.amountUsd),
      listAmountUsd: form.listAmountUsd ? Number(form.listAmountUsd) : null,
    };

    const res = await fetch("/api/admin/products", {
      method: creating ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      toast(creating ? "Producto creado" : "Producto actualizado");
      setEditing(null);
      setCreating(false);
      load();
    } else {
      const d = (await res.json()) as { error?: string };
      toast(d.error ?? "Error al guardar", "error");
    }
  };

  const remove = (id: string) => {
    confirm({
      title: "Eliminar producto",
      message:
        "Si tiene servicios vinculados se desactivará; si no, se borra. La web pública dejará de mostrarlo.",
      onConfirm: async () => {
        const res = await fetch("/api/admin/products", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (res.ok) {
          toast("Producto eliminado o desactivado");
          load();
        } else toast("No se pudo eliminar", "error");
      },
    });
  };

  const showForm = creating || editing;

  const saveUsdToCopRate = async () => {
    if (!canManageTeam || preview) return;
    const parsed = Number(usdToCopRate.replace(/\s/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast("Ingresa una tasa válida (número positivo)", "error");
      return;
    }
    setRateSaving(true);
    try {
      const res = await fetch("/api/admin/site-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usdToCopRate: Math.round(parsed) }),
      });
      if (!res.ok) {
        toast("No se pudo guardar la tasa", "error");
        return;
      }
      const data = (await res.json()) as { usdToCopRate?: number };
      if (data.usdToCopRate != null) {
        setUsdToCopRate(String(data.usdToCopRate));
      }
      toast("Tasa actualizada — la web refleja el cambio al instante");
    } catch {
      toast("Error de red al guardar la tasa", "error");
    } finally {
      setRateSaving(false);
    }
  };

  const ratePreviewCop = (usd: number) => {
    const r = Number(usdToCopRate.replace(/\s/g, ""));
    if (!Number.isFinite(r) || r <= 0) return null;
    return Math.round(usd * r).toLocaleString("es-CO");
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="crm-section-title text-xl">Productos</h1>
            <p className="crm-section-subtitle mt-1 max-w-xl">
              Precios USD, tasa COP y planes de la landing (#servicios). Al guardar,
              la web se actualiza sola.
            </p>
          </div>
          {canManageTeam && !preview && (
            <button
              type="button"
              className="crm-btn-primary crm-btn-compact"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setForm(emptyForm());
              }}
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nuevo producto</span>
            </button>
          )}
        </div>

        {canManageTeam && !preview && (
          <div className="crm-surface-card space-y-3 p-5">
            <div>
              <h2 className="text-sm font-semibold">Tasa USD → COP (referencia web)</h2>
              <p className="mt-1 text-xs text-[var(--crm-muted)]">
                Se usa en las cartas de precio (&quot;COP aprox.&quot;) y en Mercado
                Pago. Ejemplo: $80 USD × tasa = valor mostrado en pesos.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1 sm:max-w-xs">
                <label className="crm-label" htmlFor="usd-to-cop-rate">
                  COP por 1 USD
                </label>
                <input
                  id="usd-to-cop-rate"
                  type="number"
                  min={1}
                  step={1}
                  className="crm-input"
                  value={usdToCopRate}
                  onChange={(e) => setUsdToCopRate(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="crm-btn-primary"
                disabled={rateSaving}
                onClick={() => void saveUsdToCopRate()}
              >
                {rateSaving ? "Guardando…" : "Guardar tasa"}
              </button>
            </div>
            {ratePreviewCop(80) ? (
              <p className="text-xs text-[var(--crm-muted)]">
                Vista previa: $80 USD ≈ ${ratePreviewCop(80)} COP aprox.
              </p>
            ) : null}
          </div>
        )}

        {showForm && canManageTeam && (
          <div className="crm-surface-card space-y-3 p-5">
            <h2 className="text-sm font-semibold">
              {creating ? "Nuevo producto" : `Editar: ${editing?.title}`}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <SearchableSelect
                label="Tipo"
                value={form.kind}
                options={Object.entries(KIND_LABEL).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(kind) =>
                  setForm((f) => ({ ...f, kind: kind as ProductKind }))
                }
                searchMinOptions={99}
              />
              <div>
                <label className="crm-label">Título</label>
                <input
                  className="crm-input"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="crm-label">Etiqueta sesiones</label>
                <input
                  className="crm-input"
                  value={form.sessionsLabel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sessionsLabel: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="crm-label">Nº sesiones (terapia)</label>
                <input
                  type="number"
                  className="crm-input"
                  value={form.sessionsCount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sessionsCount: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="crm-label">Precio USD</label>
                <input
                  type="number"
                  className="crm-input"
                  value={form.amountUsd}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amountUsd: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="crm-label">Precio lista USD (opcional)</label>
                <input
                  type="number"
                  className="crm-input"
                  value={form.listAmountUsd}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, listAmountUsd: e.target.value }))
                  }
                />
              </div>
            </div>
            <div>
              <label className="crm-label">Fichas / descripción (una por línea)</label>
              <textarea
                className="crm-input min-h-[100px]"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="flex gap-2">
              <button type="button" className="crm-btn-primary" onClick={() => void save()}>
                Guardar
              </button>
              <button
                type="button"
                className="crm-btn-secondary"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="crm-surface-card overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-[var(--crm-muted)]">Cargando…</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--crm-border)] bg-[var(--crm-linen)]/30 text-left text-[10px] uppercase tracking-widest text-[var(--crm-muted)]">
                  <th className="p-3 font-medium">Producto</th>
                  <th className="p-3 font-medium">Tipo</th>
                  <th className="p-3 font-medium">Precio</th>
                  <th className="p-3 font-medium">Activo</th>
                  <th className="p-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const price = p.prices[0];
                  return (
                    <tr key={p.id} className="crm-table-row">
                      <td className="p-3 font-medium">{p.title}</td>
                      <td className="p-3 text-[var(--crm-muted)]">
                        {KIND_LABEL[p.kind]}
                      </td>
                      <td className="p-3">
                        {price
                          ? `$${(price.amountMinor / 100).toFixed(0)} USD`
                          : "—"}
                        {price?.listAmountMinor ? (
                          <span className="ml-1 text-[10px] line-through text-[var(--crm-muted)]">
                            ${(price.listAmountMinor / 100).toFixed(0)}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-3">{p.isActive ? "Sí" : "No"}</td>
                      <td className="p-3 text-right">
                        {canManageTeam && !preview && (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="crm-btn-ghost text-xs"
                              onClick={() => openEdit(p)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="crm-btn-ghost text-xs text-red-700"
                              onClick={() => remove(p.id)}
                            >
                              Eliminar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </CrmPageShell>
  );
};

export default ProductsPageClient;
