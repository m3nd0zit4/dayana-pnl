"use client";

import { PromoDiscountType } from "@prisma/client";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import CrmModal from "./CrmModal";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";
import { useCrm } from "./CrmProvider";

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
    });
  };

  const showForm = creating || editing;

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
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Códigos promocionales</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Aplican antes del pago, en el checkout público. Funcionan tanto en
              USD (PayPal) como en COP (Mercado Pago).
            </p>
          </div>
          {canManageTeam && !preview && (
            <Button
              size="sm"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setForm(emptyForm());
              }}
            >
              <Plus />
              <span className="hidden sm:inline">Nuevo código</span>
            </Button>
          )}
        </div>

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

            <div className="flex gap-2 pt-1">
              <Button onClick={() => void save()}>Guardar</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </CrmModal>

        <Card className="overflow-hidden py-0">
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
            ) : promoCodes.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Sin códigos promocionales</p>
            ) : (
              <>
                <div className="hidden lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Código</TableHead>
                        <TableHead>Descuento</TableHead>
                        <TableHead>Canjes</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {promoCodes.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            {p.code}
                            {p.description && (
                              <div className="text-xs font-normal text-muted-foreground">
                                {p.description}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {discountSummary(p)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {p.timesRedeemed}
                            {p.maxRedemptions != null ? ` / ${p.maxRedemptions}` : ""}
                          </TableCell>
                          <TableCell>
                            <PromoStatusBadge p={p} />
                          </TableCell>
                          <TableCell className="text-right">
                            {canManageTeam && !preview && (
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                                  Editar
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  onClick={() => remove(p)}
                                >
                                  Eliminar
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="divide-y divide-border lg:hidden">
                  {promoCodes.map((p) => (
                    <div key={p.id} className="flex items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{p.code}</div>
                        {p.description && (
                          <div className="text-xs text-muted-foreground">{p.description}</div>
                        )}
                        <div className="mt-1 text-xs text-muted-foreground">
                          {discountSummary(p)} · {p.timesRedeemed}
                          {p.maxRedemptions != null ? ` / ${p.maxRedemptions}` : ""} canjes
                        </div>
                        <div className="mt-1.5">
                          <PromoStatusBadge p={p} />
                        </div>
                      </div>
                      {canManageTeam && !preview && (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => remove(p)}
                          >
                            Eliminar
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </CrmPageShell>
  );
};

export default PromoCodesPageClient;
