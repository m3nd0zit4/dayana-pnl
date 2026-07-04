"use client";

import { ProductKind } from "@prisma/client";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";
import { useCrm } from "./CrmProvider";
import { invalidateCached } from "./hooks/useReferenceData";

type ProductPrice = {
  currency: string;
  amountMinor: number;
  listAmountMinor: number | null;
};

type Product = {
  id: string;
  kind: ProductKind;
  title: string;
  sessionsLabel: string;
  sessionsCount: number | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  prices: ProductPrice[];
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
  isActive: true,
});

const emptyCopForm = () => ({ amountCop: "", listAmountCop: "" });

type View = "usd" | "cop";

type Props = {
  preview: boolean;
  initialProducts?: Product[];
};

const ProductsPageClient = ({ preview, initialProducts }: Props) => {
  const { canManageTeam, toast, confirm } = useCrm();
  const [products, setProducts] = useState<Product[]>(initialProducts ?? []);
  const [loading, setLoading] = useState(initialProducts === undefined);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [copForm, setCopForm] = useState(emptyCopForm);
  const [view, setView] = useState<View>("usd");

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

  const usdPrice = (p: Product) => p.prices.find((pr) => pr.currency === "USD") ?? null;
  const copPrice = (p: Product) => p.prices.find((pr) => pr.currency === "COP") ?? null;

  const openEdit = (p: Product) => {
    const usd = usdPrice(p);
    const cop = copPrice(p);
    setEditing(p);
    setCreating(false);
    setForm({
      kind: p.kind,
      title: p.title,
      sessionsLabel: p.sessionsLabel,
      sessionsCount: p.sessionsCount?.toString() ?? "",
      amountUsd: usd ? String(usd.amountMinor / 100) : "",
      listAmountUsd: usd?.listAmountMinor ? String(usd.listAmountMinor / 100) : "",
      description: p.description ?? "",
      isActive: p.isActive,
    });
    setCopForm({
      amountCop: cop ? String(cop.amountMinor) : "",
      listAmountCop: cop?.listAmountMinor ? String(cop.listAmountMinor) : "",
    });
  };

  const save = async () => {
    if (!canManageTeam) return;

    // Ambas monedas viajan en un solo guardado; amountUsd vacío se omite
    // (PATCH no lo toca) y amountCop vacío viaja null (borra el precio COP).
    const payload = {
      ...(creating ? {} : { id: editing!.id }),
      kind: form.kind,
      title: form.title,
      sessionsLabel: form.sessionsLabel || form.title,
      sessionsCount: form.sessionsCount ? Number(form.sessionsCount) : null,
      description: form.description,
      isActive: form.isActive,
      ...(form.amountUsd !== "" ? { amountUsd: Number(form.amountUsd) } : {}),
      listAmountUsd: form.listAmountUsd ? Number(form.listAmountUsd) : null,
      amountCop: copForm.amountCop ? Number(copForm.amountCop) : null,
      listAmountCop: copForm.listAmountCop ? Number(copForm.listAmountCop) : null,
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
      invalidateCached("products");
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
          invalidateCached("products");
          load();
        } else toast("No se pudo eliminar", "error");
      },
    });
  };

  const showForm = creating || editing;

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="crm-section-title text-xl">Productos</h1>
            <p className="crm-section-subtitle mt-1 max-w-xl">
              USD e Internacional (PayPal) · COP e Colombia (Mercado Pago). Ambos
              precios se editan y guardan juntos.
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
                setCopForm(emptyCopForm());
              }}
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nuevo producto</span>
            </button>
          )}
        </div>

        {/* View tabs */}
        <div className="flex gap-1 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-linen)]/30 p-1 w-fit">
          {(["usd", "cop"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                view === v
                  ? "bg-white shadow-sm text-[var(--crm-text)]"
                  : "text-[var(--crm-muted)] hover:text-[var(--crm-text)]"
              }`}
            >
              {v === "usd" ? "Internacional (USD)" : "Colombia (COP)"}
            </button>
          ))}
        </div>


        {/* Edit / Create form */}
        {showForm && canManageTeam && (
          <div className="crm-surface-card space-y-4 p-5">
            <h2 className="text-sm font-semibold">
              {creating ? "Nuevo producto" : `Editar: ${editing?.title}`}
            </h2>

            {/* General fields */}
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
            </div>

            {/* Price fields — both currencies in one save */}
            <div className="border-t border-[var(--crm-border)] pt-4">
              <p className="text-[10px] uppercase tracking-widest text-[var(--crm-muted)] mb-3">
                Precio Internacional — USD (PayPal)
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
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
            </div>
            <div className="border-t border-[var(--crm-border)] pt-4">
              <p className="text-[10px] uppercase tracking-widest text-[var(--crm-muted)] mb-3">
                Precio Colombia — COP (Mercado Pago)
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="crm-label">Precio COP</label>
                  <input
                    type="number"
                    className="crm-input"
                    value={copForm.amountCop}
                    onChange={(e) =>
                      setCopForm((f) => ({ ...f, amountCop: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="crm-label">Precio lista COP (opcional)</label>
                  <input
                    type="number"
                    className="crm-input"
                    value={copForm.listAmountCop}
                    onChange={(e) =>
                      setCopForm((f) => ({ ...f, listAmountCop: e.target.value }))
                    }
                  />
                </div>
              </div>
            </div>

            {/* Description */}
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

            {/* Active toggle */}
            {!creating && (
              <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[var(--crm-border)] accent-[var(--crm-accent)] cursor-pointer"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, isActive: e.target.checked }))
                  }
                />
                <span className="text-sm text-[var(--crm-text)]">
                  Producto activo (visible en la web)
                </span>
              </label>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="crm-btn-primary"
                onClick={() => void save()}
              >
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

        {/* Product table */}
        <div className="crm-surface-card overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-[var(--crm-muted)]">Cargando…</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--crm-border)] bg-[var(--crm-linen)]/30 text-left text-[10px] uppercase tracking-widest text-[var(--crm-muted)]">
                  <th className="p-3 font-medium">Producto</th>
                  <th className="p-3 font-medium">Tipo</th>
                  <th className="p-3 font-medium">
                    {view === "usd" ? "Precio USD" : "Precio COP"}
                  </th>
                  <th className="p-3 font-medium">Activo</th>
                  <th className="p-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const usd = usdPrice(p);
                  const cop = copPrice(p);
                  const displayPrice = view === "usd" ? usd : cop;
                  const currency = view === "usd" ? "USD" : "COP";
                  return (
                    <tr key={p.id} className="crm-table-row">
                      <td className="p-3 font-medium">{p.title}</td>
                      <td className="p-3 text-[var(--crm-muted)]">
                        {KIND_LABEL[p.kind]}
                      </td>
                      <td className="p-3">
                        {displayPrice ? (
                          <>
                            {view === "usd"
                              ? (displayPrice.amountMinor / 100).toLocaleString("en-US", {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2,
                                })
                              : displayPrice.amountMinor.toLocaleString("es-CO")}{" "}
                            {currency}
                            {displayPrice.listAmountMinor ? (
                              <span className="ml-1 text-[10px] line-through text-[var(--crm-muted)]">
                                {view === "usd"
                                  ? (displayPrice.listAmountMinor / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })
                                  : displayPrice.listAmountMinor.toLocaleString("es-CO")}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[var(--crm-muted)]">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {!p.isActive ? (
                          <span className="inline-block rounded-full bg-[var(--crm-linen)] px-2 py-0.5 text-[10px] font-medium text-[var(--crm-muted)]">
                            Inactivo
                          </span>
                        ) : !displayPrice ? (
                          <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            Sin precio · No visible
                          </span>
                        ) : (
                          <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
                            Activo
                          </span>
                        )}
                      </td>
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
