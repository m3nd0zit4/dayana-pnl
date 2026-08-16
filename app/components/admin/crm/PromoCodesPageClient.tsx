"use client";

import { PromoDiscountType } from "@prisma/client";
import { TicketPercent } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import CrmModal from "./CrmModal";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";
import { groupProductsByKind } from "@/lib/crm/product-kind-labels";
import { useActiveProducts } from "@/app/components/admin/crm/hooks/useReferenceData";
import { useCrm } from "./CrmProvider";
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

type PromoCode = {
  id: string;
  code: string;
  description: string | null;
  discountType: PromoDiscountType;
  percentOff: number | null;
  amountOffUsdMinor: number | null;
  amountOffCopMinor: number | null;
  isActive: boolean;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: string | null;
  /** Vacío = vale para todos los productos. */
  products: { id: string; title: string }[];
};

const DISCOUNT_TYPE_LABEL: Record<PromoDiscountType, string> = {
  PERCENT: "% de descuento",
  FIXED_AMOUNT: "Monto fijo",
};

const emptyForm = () => ({
  code: "",
  description: "",
  discountType: "PERCENT" as PromoDiscountType,
  percentOff: "",
  amountOffUsd: "",
  amountOffCop: "",
  maxRedemptions: "",
  expiresAt: "",
  isActive: true,
  productIds: [] as string[],
});

type Props = {
  preview: boolean;
  initialPromoCodes?: PromoCode[];
};

const discountSummary = (p: PromoCode): string => {
  if (p.discountType === "PERCENT") return `${p.percentOff ?? 0}%`;
  const parts: string[] = [];
  if (p.amountOffUsdMinor) parts.push(`$${(p.amountOffUsdMinor / 100).toFixed(0)} USD`);
  if (p.amountOffCopMinor) parts.push(`$${p.amountOffCopMinor.toLocaleString("es-CO")} COP`);
  return parts.join(" · ") || "—";
};

/** Shared between the desktop table cell and the mobile card row. */
const PromoStatusBadge = ({ p }: { p: PromoCode }) => {
  const expired = p.expiresAt ? new Date(p.expiresAt) < new Date() : false;
  const maxedOut = p.maxRedemptions != null && p.timesRedeemed >= p.maxRedemptions;
  if (!p.isActive) return <Badge variant="secondary">Inactivo</Badge>;
  if (expired)
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-100 dark:text-amber-700">Vencido</Badge>
    );
  if (maxedOut)
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-100 dark:text-amber-700">Agotado</Badge>
    );
  return (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-100 dark:text-green-800">Activo</Badge>
  );
};

const PromoCodesPageClient = ({ preview, initialPromoCodes }: Props) => {
  const { canManageTeam, toast, confirm } = useCrm();
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>(initialPromoCodes ?? []);
  const [loading, setLoading] = useState(initialPromoCodes === undefined);
  const [editing, setEditing] = useState<PromoCode | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(() => {
    if (preview) {
      setPromoCodes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/admin/promo-codes")
      .then((r) => r.json())
      .then((d) => setPromoCodes(d.promoCodes ?? []))
      .catch(() => toast("Error al cargar códigos", "error"))
      .finally(() => setLoading(false));
  }, [preview, toast]);

  useEffect(() => {
    if (initialPromoCodes !== undefined) return;
    load();
  }, [initialPromoCodes, load]);

  const openEdit = (p: PromoCode) => {
    setEditing(p);
    setCreating(false);
    setForm({
      code: p.code,
      description: p.description ?? "",
      discountType: p.discountType,
      percentOff: p.percentOff?.toString() ?? "",
      amountOffUsd: p.amountOffUsdMinor ? String(p.amountOffUsdMinor / 100) : "",
      amountOffCop: p.amountOffCopMinor ? String(p.amountOffCopMinor) : "",
      maxRedemptions: p.maxRedemptions?.toString() ?? "",
      expiresAt: p.expiresAt ? p.expiresAt.slice(0, 10) : "",
      isActive: p.isActive,
      productIds: p.products.map((x) => x.id),
    });
  };

  const showForm = creating || editing;
  // Solo se cargan los productos cuando el modal está abierto: el hook cachea
  // 60 s, así que abrir y cerrar varias veces no repite la consulta.
  const { products, productsLoading } = useActiveProducts(Boolean(showForm));

  const save = async () => {
    if (!canManageTeam) return;

    const payload = {
      ...(creating ? {} : { id: editing!.id }),
      code: form.code,
      description: form.description || undefined,
      discountType: form.discountType,
      percentOff: form.discountType === "PERCENT" ? Number(form.percentOff) : null,
      amountOffUsdMinor:
        form.discountType === "FIXED_AMOUNT" && form.amountOffUsd
          ? Math.round(Number(form.amountOffUsd) * 100)
          : null,
      amountOffCopMinor:
        form.discountType === "FIXED_AMOUNT" && form.amountOffCop
          ? Math.round(Number(form.amountOffCop))
          : null,
      maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
      expiresAt: form.expiresAt || null,
      isActive: form.isActive,
      productIds: form.productIds,
    };

    const res = await fetch(
      creating ? "/api/admin/promo-codes" : `/api/admin/promo-codes/${editing!.id}`,
      {
        method: creating ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (res.ok) {
      toast(creating ? "Código creado" : "Código actualizado");
      setEditing(null);
      setCreating(false);
      load();
    } else {
      const d = (await res.json()) as { error?: string };
      const messages: Record<string, string> = {
        invalid_code: "Código inválido — usa solo letras, números y guiones.",
        invalid_percent: "El porcentaje debe estar entre 1 y 100.",
        invalid_fixed_amount: "Ingresa al menos un monto (USD o COP).",
        duplicate_code: "Ya existe un código igual.",
        forbidden: "Solo el owner puede gestionar códigos promocionales.",
      };
      toast(messages[d.error ?? ""] ?? "Error al guardar", "error");
    }
  };

  const remove = (p: PromoCode) => {
    confirm({
      title: "Eliminar código promocional",
      message:
        p.timesRedeemed > 0
          ? "Ya tiene canjes registrados — se desactivará en vez de borrarse, para no perder el historial."
          : "¿Eliminar este código? No se puede deshacer.",
      // El verbo cambia con el caso: con canjes registrados no se borra nada.
      confirmLabel: p.timesRedeemed > 0 ? "Desactivar" : "Eliminar",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/promo-codes/${p.id}`, { method: "DELETE" });
        if (res.ok) {
          toast(p.timesRedeemed > 0 ? "Código desactivado" : "Código eliminado");
          load();
        } else toast("No se pudo eliminar", "error");
      },
    });
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Códigos promocionales"
        description="Aplican antes del pago, en el checkout público. Funcionan tanto en USD (PayPal) como en COP (Mercado Pago)."
        action={
          canManageTeam && !preview ? (
            <CrmNewButton
              label="Nuevo código"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setForm(emptyForm());
              }}
            />
          ) : undefined
        }
      />

      <CrmModal
          title={creating ? "Nuevo código promocional" : `Editar: ${editing?.code ?? ""}`}
          open={!!showForm && canManageTeam}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          large
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Código</Label>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="VERANO2026"
                  className="uppercase"
                />
              </div>
              <SearchableSelect
                label="Tipo de descuento"
                value={form.discountType}
                options={Object.entries(DISCOUNT_TYPE_LABEL).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(v) =>
                  setForm((f) => ({ ...f, discountType: v as PromoDiscountType }))
                }
                searchMinOptions={99}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Descripción (opcional)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Promoción de verano — 15% off"
              />
            </div>

            {form.discountType === "PERCENT" ? (
              <div className="space-y-1.5 max-w-[200px]">
                <Label>Porcentaje off (1-100)</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={form.percentOff}
                  onChange={(e) => setForm((f) => ({ ...f, percentOff: e.target.value }))}
                  placeholder="15"
                />
              </div>
            ) : (
              <div className="border-t border-border pt-4">
                <p className="mb-3 text-[10px] tracking-widest text-muted-foreground uppercase">
                  Monto fijo por moneda — deja vacío si no aplica en esa moneda
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Descuento USD</Label>
                    <Input
                      type="number"
                      value={form.amountOffUsd}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, amountOffUsd: e.target.value }))
                      }
                      placeholder="20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Descuento COP</Label>
                    <Input
                      type="number"
                      value={form.amountOffCop}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, amountOffCop: e.target.value }))
                      }
                      placeholder="70000"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Máx. canjes (opcional)</Label>
                <Input
                  type="number"
                  value={form.maxRedemptions}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maxRedemptions: e.target.value }))
                  }
                  placeholder="Sin límite"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Vence (opcional)</Label>
                <Input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                />
              </div>
            </div>

            {/* Limitar a productos. Sin nada marcado el código vale para todo,
                que es como se comportaba antes de que esto existiera — por eso
                el estado por defecto no restringe nada. */}
            <div className="border-t border-border pt-4">
              <p className="mb-1 text-[10px] tracking-widest text-muted-foreground uppercase">
                Productos
              </p>
              <p className="mb-3 text-xs text-muted-foreground">
                {form.productIds.length === 0
                  ? "Sin marcar nada, el código sirve para cualquier producto."
                  : `Solo se podrá usar en ${form.productIds.length} producto${form.productIds.length === 1 ? "" : "s"}.`}
              </p>
              {productsLoading ? (
                <p className="text-xs text-muted-foreground">Cargando productos…</p>
              ) : (
                <div className="space-y-3">
                  {groupProductsByKind(products).map((group) => (
                    <div key={group.label} className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        {group.label}
                      </p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {group.items.map((product) => (
                          <label
                            key={product.id}
                            className="flex cursor-pointer items-center gap-2.5 select-none"
                          >
                            <Checkbox
                              checked={form.productIds.includes(product.id)}
                              onCheckedChange={(checked) =>
                                setForm((f) => ({
                                  ...f,
                                  productIds:
                                    checked === true
                                      ? [...f.productIds, product.id]
                                      : f.productIds.filter((x) => x !== product.id),
                                }))
                              }
                            />
                            <span className="text-sm">{product.title}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {form.productIds.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm((f) => ({ ...f, productIds: [] }))}
                    >
                      Quitar restricción
                    </Button>
                  ) : null}
                </div>
              )}
            </div>

            {!creating && (
              <label className="flex w-fit cursor-pointer items-center gap-2.5 select-none">
                <Checkbox
                  checked={form.isActive}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, isActive: checked === true }))
                  }
                />
                <span className="text-sm">Código activo</span>
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
        Aquí convivían una `<Table>` para `lg` y una lista de tarjetas para
        móvil con los mismos datos: dos copias del mismo contenido que había
        que mantener sincronizadas a mano. Queda una sola.
      */}
      <CrmDataList>
        {loading ? (
          <CrmLoadingState rows={4} />
        ) : promoCodes.length === 0 ? (
          <CrmEmptyState
            icon={TicketPercent}
            title="Sin códigos promocionales"
            description="Un código descuenta en el checkout antes de cobrar, en cualquiera de las dos monedas."
          />
        ) : (
          promoCodes.map((p) => (
            <CrmDataListRow
              key={p.id}
              actions={
                canManageTeam && !preview ? (
                  <CrmRowActions>
                    <CrmRowEdit onClick={() => openEdit(p)} />
                    <CrmRowDelete onClick={() => remove(p)} />
                  </CrmRowActions>
                ) : undefined
              }
            >
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <div className="font-mono text-sm font-medium">{p.code}</div>
                {p.description ? (
                  <div className="text-xs text-muted-foreground">
                    {p.description}
                  </div>
                ) : null}
                {p.products.length > 0 ? (
                  <div
                    className="text-xs text-muted-foreground"
                    title={p.products.map((x) => x.title).join(", ")}
                  >
                    Solo {p.products.length === 1
                      ? p.products[0].title
                      : `${p.products.length} productos`}
                  </div>
                ) : null}
              </div>
              <div className="text-sm text-muted-foreground sm:w-40">
                {discountSummary(p)}
              </div>
              <div className="text-sm text-muted-foreground sm:w-24">
                {p.timesRedeemed}
                {p.maxRedemptions != null ? ` / ${p.maxRedemptions}` : ""} canjes
              </div>
              <div className="sm:w-28">
                <PromoStatusBadge p={p} />
              </div>
            </CrmDataListRow>
          ))
        )}
      </CrmDataList>
    </CrmPageShell>
  );
};

export default PromoCodesPageClient;
