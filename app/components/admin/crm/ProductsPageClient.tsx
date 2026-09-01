"use client";

import { ProductKind } from "@prisma/client";
import { ChevronDown, ChevronUp, Package } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import ProductCardPreview from "./ProductCardPreview";
import StringListEditor from "./StringListEditor";
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
  tag?: string | null;
  highlight?: boolean;
  unitPriceLabel?: string | null;
  therapyHeadline?: string | null;
  whatsappMessage?: string | null;
  isActive: boolean;
  sortOrder: number;
  prices: ProductPrice[];
  paypalPlanId?: string | null;
  mercadoPagoPreapprovalPlanId?: string | null;
  priceSyncStatus?: "SYNCED" | "DRIFTED";
  priceSyncNote?: string | null;
  priceSyncCheckedAt?: string | null;
};

const KIND_LABEL: Record<ProductKind, string> = {
  THERAPY: "Terapia 1:1",
  COURSE: "Curso",
  WORKSHOP: "Taller",
};

const hasSubscriptionPlan = (p: Product) =>
  Boolean(p.paypalPlanId || p.mercadoPagoPreapprovalPlanId);

/**
 * El precio de un producto con plan recurrente sólo se guarda si PayPal y
 * Mercado Pago aceptaron cobrarlo. Cuando uno dice que no, no se guarda nada —
 * y hay que decir exactamente qué pasó, porque «Error al guardar» dejaría a
 * Dayana sin saber si el precio cambió o no.
 */
const saveErrorMessage = (d: { error?: string; message?: string }): string => {
  switch (d.error) {
    case "WORKSHOP_REQUIRES_COP":
      return "Los talleres requieren un precio COP (Mercado Pago) además del USD.";
    case "PAYPAL_FAILED":
    case "MERCADOPAGO_FAILED":
    case "PAYPAL_REVERT_FAILED":
    case "PRODUCT_DRIFTED":
      return d.message ?? "No se pudo cambiar el precio en los proveedores.";
    case "USE_CHANGE_SUBSCRIPTION_PRICE":
      return "Este precio se cobra por un plan de suscripción y hay que cambiarlo por el camino sincronizado.";
    default:
      return d.message ?? d.error ?? "Error al guardar";
  }
};

// Solo para mostrar un equivalente aproximado junto al precio USD en esta
// tabla — no es la tasa real de cobro (esa vive en lib/pricing/usd-to-cop.ts
// y se resuelve en checkout).
const DISPLAY_USD_TO_COP_RATE = 3000;
const formatCopApprox = (usdAmount: number) =>
  Math.round(usdAmount * DISPLAY_USD_TO_COP_RATE).toLocaleString("es-CO");

/**
 * Estado del precio frente a los planes del proveedor.
 *
 * Se muestra en la fila y no como un toast: un toast se va, y esto es una
 * condición que sigue siendo verdad mañana. Mientras esté descuadrado, además,
 * no se aceptan más cambios de precio.
 */
const PriceSyncNotice = ({
  product,
  canVerify,
  onVerified,
}: {
  product: Product;
  canVerify: boolean;
  onVerified: () => void;
}) => {
  const { toast } = useCrm();
  const [checking, setChecking] = useState(false);
  const drifted = product.priceSyncStatus === "DRIFTED";

  const verify = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/admin/products/verify-price-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: product.id }),
      });
      const d = (await res.json()) as { inSync?: boolean; details?: string };
      toast(d.details ?? "Verificado", d.inSync ? "success" : "error");
      onVerified();
    } catch {
      toast("No se pudo verificar con los proveedores.", "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {drifted ? (
        <span className="text-xs text-destructive">
          {product.priceSyncNote ??
            "El precio no coincide con lo que cobran los planes."}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          Precio sincronizado con los planes de cobro
          {product.priceSyncCheckedAt
            ? ` · ${new Date(product.priceSyncCheckedAt).toLocaleDateString("es-CO")}`
            : ""}
        </span>
      )}
      {canVerify ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => void verify()}
          disabled={checking}
        >
          {checking ? "Verificando…" : "Verificar ahora"}
        </Button>
      ) : null}
    </div>
  );
};

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
    <Badge className="border-success/40 bg-success/10 text-success">Activo</Badge>
  ) : view === "cop" && usd ? (
    <Badge className="border-warning/40 bg-warning/10 text-warning">
      Sin COP · Oculto en Colombia
    </Badge>
  ) : view === "usd" && cop ? (
    <Badge className="border-warning/40 bg-warning/10 text-warning">
      Sin USD · Oculto internacional
    </Badge>
  ) : (
    <Badge className="border-warning/40 bg-warning/10 text-warning">Sin precio · No visible</Badge>
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
  // Presentación: lo que la tarjeta pública enseña además del precio. Vivían
  // sólo en el seed, así que poner un "Más elegido" exigía tocar código.
  tag: "",
  highlight: false,
  unitPriceLabel: "",
  therapyHeadline: "",
  whatsappMessage: "",
});

const emptyCopForm = () => ({ amountCop: "", listAmountCop: "" });

/**
 * `Product.description` guarda las viñetas como un texto con saltos de línea
 * —así lo parte `productToPlan`— pero se editan una a una. Estas dos funciones
 * son la traducción entre las dos formas, y están juntas para que nadie cambie
 * el separador en un sentido y no en el otro.
 */
const descriptionToItems = (description: string): string[] =>
  description.split("\n").filter((line) => line.trim() !== "");

const itemsToDescription = (items: string[]): string => items.join("\n");

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
  const [uploadingCover, setUploadingCover] = useState(false);
  const [reordering, setReordering] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const uploadCover = async (file: File) => {
    setUploadingCover(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/products/cover", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        toast(
          data.error === "file_too_large"
            ? "La imagen pesa más de 6 MB."
            : data.error === "invalid_mime"
              ? "Formato no admitido: usa JPG, PNG, WEBP o AVIF."
              : "No se pudo subir la portada.",
          "error",
        );
        return;
      }
      setForm((f) => ({ ...f, imageUrl: data.url! }));
    } finally {
      setUploadingCover(false);
    }
  };

  /**
   * Reordena mandando la lista entera, no "sube este uno": dos pestañas
   * abiertas sobre el mismo catálogo no pueden dejar el orden a medias.
   * El estado local se mueve antes de la respuesta y se revierte si falla,
   * porque la flecha tiene que responder al instante.
   */
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= products.length || reordering) return;
    const previous = products;
    const next = [...products];
    [next[index], next[target]] = [next[target], next[index]];
    setProducts(next);
    setReordering(true);
    const res = await fetch("/api/admin/products/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((p) => p.id) }),
    }).catch(() => null);
    setReordering(false);
    if (!res?.ok) {
      setProducts(previous);
      toast("No se pudo reordenar el catálogo", "error");
    } else {
      invalidateCached("products");
    }
  };

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
      tag: p.tag ?? "",
      highlight: p.highlight ?? false,
      unitPriceLabel: p.unitPriceLabel ?? "",
      therapyHeadline: p.therapyHeadline ?? "",
      whatsappMessage: p.whatsappMessage ?? "",
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
      tag: form.tag.trim() || null,
      highlight: form.highlight,
      unitPriceLabel: form.unitPriceLabel.trim() || null,
      therapyHeadline: form.therapyHeadline.trim() || null,
      whatsappMessage: form.whatsappMessage.trim() || null,
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
      const d = (await res.json()) as { error?: string; message?: string };
      toast(saveErrorMessage(d), "error");
      // Un fallo de sincronización cambia el estado del producto: hay que
      // recargar para que el aviso persistente aparezca sin refrescar a mano.
      load();
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
          {/*
            Formulario a la izquierda, tarjeta pública a la derecha. La vista
            previa se queda pegada al hacer scroll porque el formulario es más
            alto que ella: si se fuera hacia arriba al escribir las viñetas,
            justo dejaría de verse en el momento en que cambia.
          */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
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
                  <Label>Portada</Label>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 space-y-2">
                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void uploadCover(file);
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={uploadingCover}
                        onClick={() => coverInputRef.current?.click()}
                      >
                        {uploadingCover ? "Subiendo…" : "Subir imagen"}
                      </Button>
                      <Input
                        value={form.imageUrl}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, imageUrl: e.target.value }))
                        }
                        placeholder="…o pega una URL"
                      />
                    </div>
                    {form.imageUrl.trim() && (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL, no next/image domain config for it
                      <img
                        src={form.imageUrl.trim()}
                        alt=""
                        className="h-16 w-24 shrink-0 rounded-md object-cover ring-1 ring-border"
                        onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                      />
                    )}
                  </div>
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

              {/*
                Las viñetas se guardan como un texto con saltos de línea —así
                las lee `productToPlan`— pero se editan una a una: en un
                `<textarea>` no se ve cuál es cada ficha de la tarjeta ni se
                pueden reordenar sin cortar y pegar.
              */}
              <StringListEditor
                label="Fichas de la tarjeta"
                items={descriptionToItems(form.description)}
                onChange={(items) =>
                  setForm((f) => ({ ...f, description: itemsToDescription(items) }))
                }
                placeholder="Ej. 4 sesiones de 60 minutos"
                addLabel="Agregar ficha"
              />

              <div className="border-t border-border pt-4">
                <p className="mb-3 text-[10px] tracking-widest text-muted-foreground uppercase">
                  Presentación
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Etiqueta corta</Label>
                    <Input
                      value={form.tag}
                      onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
                      placeholder="Ej. Más elegido"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Precio por unidad</Label>
                    <Input
                      value={form.unitPriceLabel}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, unitPriceLabel: e.target.value }))
                      }
                      placeholder="Ej. / sesión"
                    />
                  </div>
                </div>

                <label className="mt-3 flex w-fit cursor-pointer items-center gap-2.5 select-none">
                  <Checkbox
                    checked={form.highlight}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, highlight: checked === true }))
                    }
                  />
                  <span className="text-sm">Destacar esta tarjeta</span>
                </label>

                <div className="mt-3 space-y-1.5">
                  <Label>Titular en el diagnóstico (opcional)</Label>
                  <Input
                    value={form.therapyHeadline}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, therapyHeadline: e.target.value }))
                    }
                    placeholder="Frase con la que se presenta al recomendarlo"
                  />
                </div>

                <div className="mt-3 space-y-1.5">
                  <Label>Mensaje de WhatsApp (opcional)</Label>
                  <Textarea
                    className="min-h-[70px]"
                    value={form.whatsappMessage}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, whatsappMessage: e.target.value }))
                    }
                    placeholder="Texto con el que se abre el chat desde este paquete"
                  />
                </div>
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

          </div>

          <div className="lg:sticky lg:top-0 lg:self-start">
            <ProductCardPreview
              input={{
                kind: form.kind,
                title: form.title,
                sessionsLabel: form.sessionsLabel,
                sessionsCount: form.sessionsCount,
                description: form.description,
                imageUrl: form.imageUrl,
                tag: form.tag,
                highlight: form.highlight,
                unitPriceLabel: form.unitPriceLabel,
                amountUsd: form.amountUsd,
                listAmountUsd: form.listAmountUsd,
                amountCop: copForm.amountCop,
                listAmountCop: copForm.listAmountCop,
              }}
            />
          </div>
          </div>

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
          products.map((p, index) => {
            const usd = usdPrice(p);
            const cop = copPrice(p);
            const displayPrice = view === "usd" ? usd : cop;
            return (
              <CrmDataListRow
                key={p.id}
                actions={
                  canManageTeam && !preview ? (
                    <CrmRowActions>
                      {/*
                        El orden de esta lista es el orden en que la web
                        muestra el catálogo. Se editaba sólo por `sortOrder`
                        desde un script.
                      */}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Subir ${p.title}`}
                        disabled={index === 0 || reordering}
                        onClick={() => void move(index, -1)}
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Bajar ${p.title}`}
                        disabled={index === products.length - 1 || reordering}
                        onClick={() => void move(index, 1)}
                      >
                        <ChevronDown className="size-4" />
                      </Button>
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
                  {hasSubscriptionPlan(p) ? (
                    <PriceSyncNotice
                      product={p}
                      canVerify={canManageTeam && !preview}
                      onVerified={load}
                    />
                  ) : null}
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
