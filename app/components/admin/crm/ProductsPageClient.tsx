"use client";

import { ProductKind } from "@prisma/client";
import { Package } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmModal from "./CrmModal";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import CrmSegmentedControl from "./CrmSegmentedControl";
import SearchableSelect from "./SearchableSelect";
import { useCrm } from "./CrmProvider";
import { invalidateCached } from "./hooks/useReferenceData";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmFormActions,
  CrmLoadingState,
  CrmRowActions,
  CrmRowDelete,
  CrmRowEdit,
} from "./ui";

type ProductPrice = {
  currency: string;
  amountMinor: number;
  listAmountMinor: number | null;
};

type Product = {
  id: string;
  kind: ProductKind;
  title: string;
  imageUrl: string | null;
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

// Solo para mostrar un equivalente aproximado junto al precio USD en esta
// tabla — no es la tasa real de cobro (esa vive en lib/pricing/usd-to-cop.ts
// y se resuelve en checkout).
const DISPLAY_USD_TO_COP_RATE = 3000;
const formatCopApprox = (usdAmount: number) =>
  Math.round(usdAmount * DISPLAY_USD_TO_COP_RATE).toLocaleString("es-CO");

/** Shared between the desktop table cell and the mobile card row. */
const ProductPriceDisplay = ({
  view,
  displayPrice,
}: {
  view: View;
  displayPrice: ProductPrice | null;
}) =>
  displayPrice ? (
    <>
      {view === "usd"
        ? (displayPrice.amountMinor / 100).toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })
        : displayPrice.amountMinor.toLocaleString("es-CO")}{" "}
      {view === "usd" ? "USD" : "COP"}
      {displayPrice.listAmountMinor ? (
        <span className="ml-1 text-[10px] text-muted-foreground line-through">
          {view === "usd"
            ? (displayPrice.listAmountMinor / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })
            : displayPrice.listAmountMinor.toLocaleString("es-CO")}
        </span>
      ) : null}
      {view === "usd" && (
        <div className="mt-0.5 text-xs text-muted-foreground">
          ≈ ${formatCopApprox(displayPrice.amountMinor / 100)} COP
        </div>
      )}
    </>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

const ProductStatusBadge = ({
  view,
  isActive,
  displayPrice,
  usd,
  cop,
}: {
  view: View;
  isActive: boolean;
  displayPrice: ProductPrice | null;
  usd: ProductPrice | null;
  cop: ProductPrice | null;
}) =>
  !isActive ? (
    <Badge variant="secondary">Inactivo</Badge>
  ) : displayPrice ? (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-100 dark:text-green-800">Activo</Badge>
  ) : view === "cop" && usd ? (
    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-100 dark:text-amber-700">
      Sin COP · Oculto en Colombia
    </Badge>
  ) : view === "usd" && cop ? (
    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-100 dark:text-amber-700">
      Sin USD · Oculto internacional
    </Badge>
  ) : (
    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-100 dark:text-amber-700">Sin precio · No visible</Badge>
  );

const emptyForm = () => ({
  kind: "THERAPY" as ProductKind,
  title: "",
  imageUrl: "",
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
      .catch(() => toast("Error al cargar paquetes", "error"))
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
      imageUrl: p.imageUrl ?? "",
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

    if (form.kind === "WORKSHOP" && !copForm.amountCop) {
      toast("Los talleres requieren un precio COP (Mercado Pago) además del USD.", "error");
      return;
    }

    // Ambas monedas viajan en un solo guardado; amountUsd vacío se omite
    // (PATCH no lo toca) y amountCop vacío viaja null (borra el precio COP).
    const payload = {
      ...(creating ? {} : { id: editing!.id }),
      kind: form.kind,
      title: form.title,
      imageUrl: form.imageUrl.trim() || null,
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
      toast(creating ? "Paquete creado" : "Paquete actualizado");
      setEditing(null);
      setCreating(false);
      invalidateCached("products");
      load();
    } else {
      const d = (await res.json()) as { error?: string };
      const message =
        d.error === "WORKSHOP_REQUIRES_COP"
          ? "Los talleres requieren un precio COP (Mercado Pago) además del USD."
          : (d.error ?? "Error al guardar");
      toast(message, "error");
    }
  };

  const remove = (id: string) => {
    confirm({
      title: "Eliminar paquete",
      message:
        "Si tiene servicios vinculados se desactivará; si no, se borra. La web pública dejará de mostrarlo.",
      confirmLabel: "Eliminar",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch("/api/admin/products", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (res.ok) {
          toast("Paquete eliminado o desactivado");
          invalidateCached("products");
          load();
        } else toast("No se pudo eliminar", "error");
      },
    });
  };

  const showForm = creating || editing;

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Paquetes"
        description="USD e Internacional (PayPal) · COP y Colombia (Mercado Pago). Ambos precios se editan y guardan juntos."
        action={
          canManageTeam && !preview ? (
            <CrmNewButton
              label="Nuevo paquete"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setForm(emptyForm());
                setCopForm(emptyCopForm());
              }}
            />
          ) : undefined
        }
        trailing={
          <CrmSegmentedControl
            value={view}
            onChange={setView}
            aria-label="Moneda"
            segments={[
              { id: "usd" as View, label: "Internacional (USD)" },
              { id: "cop" as View, label: "Colombia (COP)" },
            ]}
          />
        }
      />

      {/* Edit / Create form */}
      <CrmModal
          title={creating ? "Nuevo paquete" : `Editar: ${editing?.title ?? ""}`}
          open={!!showForm && canManageTeam}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          large
        >
          <div className="space-y-4">
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
                <div className="space-y-1.5">
                  <Label>Título</Label>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Imagen de portada (URL)</Label>
                  <div className="flex items-start gap-3">
                    <Input
                      value={form.imageUrl}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, imageUrl: e.target.value }))
                      }
                      placeholder="https://…/portada-curso.jpg"
                    />
                    {form.imageUrl.trim() && (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL, no next/image domain config for it
                      <img
                        src={form.imageUrl.trim()}
                        alt=""
                        className="h-12 w-20 shrink-0 rounded-md object-cover ring-1 ring-border"
                        onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Aparece como portada en el panel de miembros (curso) y en la web pública.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Etiqueta sesiones</Label>
                  <Input
                    value={form.sessionsLabel}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sessionsLabel: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Nº sesiones (terapia)</Label>
                  <Input
                    type="number"
                    value={form.sessionsCount}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sessionsCount: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <p className="mb-3 text-[10px] tracking-widest text-muted-foreground uppercase">
                  Precio Internacional — USD (PayPal)
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Precio USD</Label>
                    <Input
                      type="number"
                      value={form.amountUsd}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, amountUsd: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Precio lista USD (opcional)</Label>
                    <Input
                      type="number"
                      value={form.listAmountUsd}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, listAmountUsd: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <p className="mb-3 text-[10px] tracking-widest text-muted-foreground uppercase">
                  Precio Colombia — COP (Mercado Pago)
                  {form.kind === "WORKSHOP" ? " (requerido para talleres)" : ""}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Precio COP{form.kind === "WORKSHOP" ? " *" : ""}</Label>
                    <Input
                      type="number"
                      value={copForm.amountCop}
                      onChange={(e) =>
                        setCopForm((f) => ({ ...f, amountCop: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Precio lista COP (opcional)</Label>
                    <Input
                      type="number"
                      value={copForm.listAmountCop}
                      onChange={(e) =>
                        setCopForm((f) => ({ ...f, listAmountCop: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Fichas / descripción (una por línea)</Label>
                <Textarea
                  className="min-h-[100px]"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>

              {!creating && (
                <label className="flex w-fit cursor-pointer items-center gap-2.5 select-none">
                  <Checkbox
                    checked={form.isActive}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, isActive: checked === true }))
                    }
                  />
                  <span className="text-sm">Paquete activo (visible en la web)</span>
                </label>
              )}

              <CrmFormActions size="sm">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    setCreating(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button onClick={() => void save()}>Guardar</Button>
              </CrmFormActions>
          </div>
        </CrmModal>

      {/*
        Antes esta lista se enviaba dos veces: una `<Table>` para `lg` y una
        lista de tarjetas duplicada para móvil, con el mismo contenido escrito
        dos veces y mantenido a mano. Ahora es una sola fila que se reordena
        sola: las columnas quedan alineadas en pantalla ancha porque cada celda
        tiene su anchura, y se apilan en móvil sin media query aparte.
      */}
      <CrmDataList>
        {loading ? (
          <CrmLoadingState rows={4} />
        ) : products.length === 0 ? (
          <CrmEmptyState
            icon={Package}
            title="Sin paquetes"
            description="Los paquetes son lo que se vende en la web: terapias, cursos y talleres."
          />
        ) : (
          products.map((p) => {
            const usd = usdPrice(p);
            const cop = copPrice(p);
            const displayPrice = view === "usd" ? usd : cop;
            return (
              <CrmDataListRow
                key={p.id}
                actions={
                  canManageTeam && !preview ? (
                    <CrmRowActions>
                      <CrmRowEdit onClick={() => openEdit(p)} />
                      <CrmRowDelete onClick={() => remove(p.id)} />
                    </CrmRowActions>
                  ) : undefined
                }
              >
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <div className="text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {KIND_LABEL[p.kind]}
                  </div>
                </div>
                <div className="text-sm sm:w-40">
                  <ProductPriceDisplay view={view} displayPrice={displayPrice} />
                </div>
                <div className="sm:w-36">
                  <ProductStatusBadge
                    view={view}
                    isActive={p.isActive}
                    displayPrice={displayPrice}
                    usd={usd}
                    cop={cop}
                  />
                </div>
              </CrmDataListRow>
            );
          })
        )}
      </CrmDataList>
    </CrmPageShell>
  );
};

export default ProductsPageClient;
