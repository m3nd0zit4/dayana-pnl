"use client";

import Link from "next/link";
import { Copy, Link2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import ContactPickerField from "./ContactPickerField";
import CrmModal from "./CrmModal";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import SearchableSelect from "./SearchableSelect";
import { useCrm } from "./CrmProvider";
import { useActiveProducts } from "./hooks/useReferenceData";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmFormActions,
  CrmLoadingState,
  CrmRowAction,
  CrmRowActions,
  CrmRowDelete,
} from "./ui";

export type PaymentLinkListRow = {
  id: string;
  token: string;
  note: string | null;
  expiresAt: string | null;
  openedAt: string | null;
  checkoutStartedAt: string | null;
  paidAt: string | null;
  enrollmentId: string | null;
  revokedAt: string | null;
  createdAt: string;
  product: { id: string; title: string };
  /** `null` en un enlace abierto, creado sin ficha. */
  contact: { id: string; firstName: string; lastName: string | null } | null;
};

type Props = {
  preview: boolean;
  initialLinks?: PaymentLinkListRow[];
  siteUrl: string;
};

const emptyForm = () => ({
  contactId: "",
  contactLabel: "",
  productId: "",
  note: "",
  expiresInDays: "30",
  // Datos escritos a mano cuando la persona todavia no esta en el CRM.
  buyerName: "",
  buyerPhone: "",
  buyerEmail: "",
});

/**
 * Genera el enlace que Dayana manda por WhatsApp tras acordar un paquete.
 *
 * Todo el valor está en lo que la página del enlace **no** tiene: catálogo,
 * comparativa, otras opciones. Aquí sólo se elige a quién, qué, y una nota de
 * una línea que recuerde de qué se habló.
 */
const PaymentLinksPageClient = ({ preview, initialLinks, siteUrl }: Props) => {
  const { canManageTeam, toast, confirm } = useCrm();
  const [links, setLinks] = useState<PaymentLinkListRow[]>(initialLinks ?? []);
  const [contactQuery, setContactQuery] = useState("");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  /*
    `?estado=sin-pagar` es a donde lleva «Para hoy». Tiene que enseñar
    exactamente lo que allí se cuenta —con persona, abierto, sin pagar, sin
    revocar y sin caducar—; antes aterrizaba en la lista entera y el número de
    la portada no se encontraba en ningún sitio.
  */
  // «Ahora» se fija una vez por montaje: leer el reloj durante el render daría
  // un resultado distinto en cada render, y React lo prohíbe.
  const [nowMs] = useState(() => Date.now());
  const onlyUnpaid = searchParams.get("estado") === "sin-pagar";
  const visibleLinks = onlyUnpaid
    ? links.filter(
        (l) =>
          l.contact !== null &&
          Boolean(l.openedAt) &&
          !l.paidAt &&
          !l.revokedAt &&
          (!l.expiresAt || new Date(l.expiresAt).getTime() > nowMs)
      )
    : links;
  const [loading, setLoading] = useState(initialLinks === undefined);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (preview) {
      setLinks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/admin/payment-links")
      .then((r) => r.json())
      .then((d) => setLinks(d.links ?? []))
      .catch(() => toast("Error al cargar los enlaces", "error"))
      .finally(() => setLoading(false));
  }, [preview, toast]);

  useEffect(() => {
    if (initialLinks !== undefined) return;
    load();
  }, [initialLinks, load]);

  const { products } = useActiveProducts(creating);

  const urlFor = (token: string) => `${siteUrl}/pagar/${token}`;

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      toast("Enlace copiado", "success");
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  /**
   * El enlace de TODAS las terapias (`/pagar/terapias`): no depende de ningún
   * id, así que se construye igual que el de un enlace fijo de paquete —
   * `siteUrl` más la ruta— y no una fila de `PaymentLink`.
   */
  const therapiesLinkUrl = `${siteUrl}/pagar/terapias`;

  const copyTherapiesLink = async () => {
    try {
      await navigator.clipboard.writeText(therapiesLinkUrl);
      toast("Enlace copiado", "success");
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  /**
   * Lo que impide crear el enlace tal como está escrito, o `null`.
   *
   * Lo único obligatorio es el producto: sin contacto y sin datos el enlace se
   * crea igual, abierto. Si se escribe a alguien, basta con su nombre: el
   * teléfono y el correo son opcionales (el enlace la saluda por su nombre y
   * el cobro se cuelga de su ficha). Un teléfono o correo sin nombre sí se
   * rechaza, porque acabaría saludando con el número.
   */
  const formProblem = (): string | null => {
    if (!form.productId) return "Elige el producto.";
    // Texto escrito en la búsqueda sin elegir a nadie: antes se ignoraba y salía
    // un enlace abierto, el mismo error que con un nombre suelto.
    if (!form.contactId && contactQuery.trim()) {
      return "Elige un contacto de la lista, o borra la búsqueda y escribe los datos abajo.";
    }
    if (!form.contactId) {
      const name = form.buyerName.trim();
      const phone = form.buyerPhone.trim();
      const email = form.buyerEmail.trim();
      if ((phone || email) && !name) return "Escribe el nombre de quien paga.";
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return "El correo no parece válido.";
      }
      if (phone && phone.replace(/\D/g, "").length < 7) {
        return "El teléfono no parece válido: incluye el indicativo del país.";
      }
    }
    const days = form.expiresInDays.trim();
    if (days && !/^\d+$/.test(days)) return "La caducidad es un número entero de días.";
    if (days && (Number(days) < 1 || Number(days) > 90)) {
      return "La caducidad va de 1 a 90 días, o déjala vacía para que no caduque.";
    }
    return null;
  };

  const ERROR_MESSAGES: Record<string, string> = {
    invalid_email: "El correo no parece válido.",
    invalid_phone: "El teléfono no parece válido: incluye el indicativo del país.",
    invalid_expiry: "La caducidad va de 1 a 90 días.",
    missing_name: "Escribe el nombre de quien paga.",
    missing_contact_data: "Para un enlace a nombre de alguien, añade su teléfono o su correo.",
    missing_product: "Elige el producto.",
  };

  const save = async () => {
    const problem = formProblem();
    if (problem) {
      toast(problem, "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: form.contactId || undefined,
          // Se manda en cuanto hay algo escrito, no sólo con teléfono o correo:
          // así el servidor también rechaza un nombre suelto en vez de
          // convertirlo en un enlace abierto sin decir nada.
          buyer:
            !form.contactId &&
            (form.buyerName.trim() || form.buyerPhone.trim() || form.buyerEmail.trim())
              ? {
                  firstName: form.buyerName.trim() || undefined,
                  phone: form.buyerPhone.trim() || undefined,
                  email: form.buyerEmail.trim() || undefined,
                }
              : undefined,
          productId: form.productId,
          note: form.note.trim() || undefined,
          expiresInDays: form.expiresInDays
            ? Number(form.expiresInDays)
            : null,
        }),
      });
      const data = (await res.json()) as {
        link?: PaymentLinkListRow;
        error?: string;
      };
      if (!res.ok || !data.link) {
        toast(
          (data.error && ERROR_MESSAGES[data.error]) ?? "No se pudo crear el enlace",
          "error"
        );
        return;
      }
      setLinks((prev) => [data.link!, ...prev]);
      setCreating(false);
      setForm(emptyForm());
      await copy(data.link.token);
    } finally {
      setSaving(false);
    }
  };

  const revoke = (row: PaymentLinkListRow) => {
    confirm({
      title: "Revocar el enlace",
      message: `El enlace de ${row.product.title} dejará de funcionar. Quien lo tenga abierto verá una página de error.`,
      confirmLabel: "Revocar",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/payment-links?id=${row.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          toast("No se pudo revocar", "error");
          return;
        }
        setLinks((prev) =>
          prev.map((l) =>
            l.id === row.id
              ? { ...l, revokedAt: new Date().toISOString() }
              : l,
          ),
        );
        toast("Enlace revocado", "success");
      },
    });
  };

  const statusOf = (row: PaymentLinkListRow) => {
    // Cobrado primero: gana a revocado y a vencido. Un enlace que ya trajo el
    // dinero es eso, pase lo que pase con el enlace despues.
    if (row.paidAt) return { label: "Pagado", tone: "paid" as const };
    if (row.revokedAt) return { label: "Revocado", tone: "muted" as const };
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return { label: "Vencido", tone: "muted" as const };
    }
    if (row.checkoutStartedAt) {
      return { label: "Empezó a pagar", tone: "active" as const };
    }
    if (row.openedAt) return { label: "Lo abrió", tone: "active" as const };
    return { label: "Sin abrir", tone: "muted" as const };
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Enlaces de pago"
        description={
          // Una sola explicación, aquí donde se decide crear uno. Estaba dos
          // veces —esta línea y un aviso debajo— y el aviso empujaba la lista.
          <>
            Para una sola persona: el cobro queda en su ficha. Para varias,
            usa el enlace fijo de cada paquete en{" "}
            <Link href="/admin/products" className="underline underline-offset-2">
              Paquetes
            </Link>
            .
          </>
        }
        action={
          canManageTeam && !preview ? (
            <CrmNewButton
              label="Nuevo enlace"
              onClick={() => {
                setForm(emptyForm());
                setCreating(true);
              }}
            />
          ) : undefined
        }
      />

      {/*
        Secundaria a propósito: la acción principal de esta pantalla es «Nuevo
        enlace» (un producto, una persona). Esto es la excepción de mandarlo
        todo de una vez — sin id de producto y sin ficha — así que va aparte,
        con menos peso visual, no junto al botón primario de la cabecera.
      */}
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Enlace de todas las terapias
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Enseña cada terapia activa a precio de catálogo. No está
              publicado en ningún otro sitio — sólo quien reciba este enlace
              lo ve.
            </p>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground/80">
              {therapiesLinkUrl}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyTherapiesLink()}
          >
            <Copy aria-hidden />
            Copiar enlace
          </Button>
        </CardContent>
      </Card>

      <CrmModal
        title="Nuevo enlace de pago"
        open={creating && canManageTeam}
        onClose={() => setCreating(false)}
      >
        <div className="space-y-4">
          {/* El producto primero: es lo unico obligatorio y lo que decide el
              precio. A quien se le manda puede no saberse todavia. */}
          <SearchableSelect
            id="payment-link-product"
            label="Producto"
            value={form.productId}
            onChange={(v) => setForm((f) => ({ ...f, productId: v }))}
            options={(products ?? []).map((p) => ({
              value: p.id,
              label: p.title,
            }))}
            placeholder="Elige el producto"
          />

          <div className="space-y-2">
            <ContactPickerField
              id="payment-link-contact"
              onQueryChange={setContactQuery}
              label="Para quién (opcional)"
              value={form.contactLabel}
              onSelect={(c) =>
                setForm((f) => ({
                  ...f,
                  contactId: c?.id ?? "",
                  contactLabel: c
                    ? `${c.firstName} ${c.lastName ?? ""}`.trim()
                    : "",
                }))
              }
              placeholder="Busca un contacto, o escribe los datos abajo"
            />

            {/* Sin contacto elegido, se puede escribir a mano. Se da de alta
                al crear el enlace, no al pagar, para que el cobro salga ya con
                dueno. Si tampoco se escribe nada, el enlace es abierto. */}
            {!form.contactId && (
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  aria-label="Nombre de quien paga"
                  value={form.buyerName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerName: e.target.value }))
                  }
                  placeholder="Nombre"
                  maxLength={120}
                />
                <Input
                  aria-label="Teléfono de quien paga"
                  type="tel"
                  value={form.buyerPhone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerPhone: e.target.value }))
                  }
                  placeholder="Teléfono"
                  maxLength={30}
                />
                <Input
                  aria-label="Correo de quien paga"
                  type="email"
                  value={form.buyerEmail}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerEmail: e.target.value }))
                  }
                  placeholder="Correo"
                  maxLength={200}
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-1.5">
              <Label htmlFor="payment-link-note">Nota (opcional)</Label>
              <Input
                id="payment-link-note"
                value={form.note}
                onChange={(e) =>
                  setForm((f) => ({ ...f, note: e.target.value }))
                }
                placeholder="Lo que hablamos el martes."
                maxLength={400}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payment-link-expiry">Caduca (días)</Label>
              <Input
                id="payment-link-expiry"
                type="number"
                min={1}
                max={90}
                value={form.expiresInDays}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expiresInDays: e.target.value }))
                }
                placeholder="Sin caducidad"
              />
            </div>
          </div>

          <CrmFormActions size="sm">
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !form.productId}
            >
              {saving ? "Creando…" : "Crear y copiar"}
            </Button>
          </CrmFormActions>
        </div>
      </CrmModal>

      {loading ? (
        <CrmLoadingState />
      ) : (onlyUnpaid ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm">
          <span>
            Enlaces abiertos sin pagar: {visibleLinks.length}
          </span>
          <button
            type="button"
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => router.push(pathname)}
          >
            Ver todos
          </button>
        </div>
      ) : null)}

      {loading ? null : visibleLinks.length === 0 ? (
        <CrmEmptyState
          icon={Link2}
          title="Todavía no has generado ningún enlace"
          description="Cuando cierres un paquete por llamada, genera aquí el enlace y mándaselo. Verá sólo eso, listo para pagar."
        />
      ) : (
        <CrmDataList>
          {visibleLinks.map((row) => {
            const status = statusOf(row);
            const dead =
              Boolean(row.revokedAt) ||
              (row.expiresAt ? new Date(row.expiresAt) < new Date() : false);
            return (
              <CrmDataListRow
                key={row.id}
                actions={
                  <CrmRowActions>
                    <CrmRowAction
                      icon={Copy}
                      label="Copiar enlace"
                      onClick={() => void copy(row.token)}
                      disabled={dead}
                    />
                    {canManageTeam && !dead && (
                      <CrmRowDelete
                        label="Revocar"
                        onClick={() => revoke(row)}
                      />
                    )}
                  </CrmRowActions>
                }
              >
                <div className="min-w-0 flex-1 basis-52">
                  {/* Un enlace abierto no tiene a quien nombrar. Se dice lo
                      que es en vez de dejar el hueco: la lista tiene que
                      distinguir de un vistazo los dos tipos. */}
                  <p className="truncate font-medium">
                    {row.contact
                      ? `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim()
                      : "Enlace abierto"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.product.title}
                  </p>
                </div>

                <div className="min-w-0 sm:w-56">
                  <p className="truncate text-xs text-muted-foreground">
                    {row.note ?? "—"}
                  </p>
                  {/* Sin fechas, veinte «Enlace abierto» del mismo paquete eran
                      indistinguibles. */}
                  <p className="truncate text-xs text-muted-foreground">
                    Creado {new Date(row.createdAt).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
                    {row.expiresAt
                      ? ` · caduca ${new Date(row.expiresAt).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}`
                      : " · sin caducidad"}
                  </p>
                </div>

                <div className="sm:w-36">
                  {status.tone === "paid" ? (
                    row.enrollmentId ? (
                      <Link
                        href={`/admin/enrollments/${row.enrollmentId}`}
                        className="inline-flex"
                      >
                        <Badge className="border-success/40 bg-success/10 text-success">
                          {status.label} →
                        </Badge>
                      </Link>
                    ) : (
                      <Badge className="border-success/40 bg-success/10 text-success">
                        {status.label}
                      </Badge>
                    )
                  ) : status.tone === "active" ? (
                    <Badge variant="secondary">{status.label}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {status.label}
                    </span>
                  )}
                </div>
              </CrmDataListRow>
            );
          })}
        </CrmDataList>
      )}
    </CrmPageShell>
  );
};

export default PaymentLinksPageClient;
