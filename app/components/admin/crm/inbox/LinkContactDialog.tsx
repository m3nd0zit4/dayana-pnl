"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { useCrm } from "../CrmProvider";
import { humanizeInboxError } from "./types";

type ContactHit = {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  phoneE164: string;
  email: string | null;
};

type Props = {
  conversationId: string;
  onClose: () => void;
  onLinked: () => void;
};

/**
 * Vincula un hilo a un contacto del CRM.
 *
 * Instagram y Messenger nunca entregan teléfono ni correo, así que este paso es
 * manual por necesidad. Al guardarlo se escribe una identidad de canal, de modo
 * que el próximo hilo de esa persona nace ya vinculado.
 */
const LinkContactDialog = ({ conversationId, onClose, onLinked }: Props) => {
  const { toast } = useCrm();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  // Se deriva en vez de limpiarse en un efecto: con menos de dos caracteres no
  // hay nada que enseñar, y borrar el estado por efecto provoca un render extra.
  const term = query.trim();
  const visibleHits = term.length < 2 ? [] : hits;

  useEffect(() => {
    if (term.length < 2) return;

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/admin/contacts?q=${encodeURIComponent(term)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { contacts?: ContactHit[] };
        // El endpoint devuelve hasta 80; aquí solo caben unos pocos en pantalla.
        setHits((data.contacts ?? []).slice(0, 8));
      } catch {
        // Silencioso: el operador puede seguir escribiendo y reintentar.
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [term]);

  const link = async (contactId: string) => {
    setLinking(contactId);
    try {
      const res = await fetch(`/api/admin/inbox/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", contactId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(humanizeInboxError(data.error), "error");
        return;
      }
      toast("Conversación vinculada. Los próximos hilos se reconocerán solos.");
      onLinked();
    } catch {
      toast("No se pudo vincular. Revisa tu conexión.", "error");
    } finally {
      setLinking(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular a un contacto</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Instagram y Messenger no entregan teléfono ni correo. Vincula solo si
            estás seguro de quién es: un enlace equivocado mete la conversación
            de un desconocido en la ficha de una clienta real.
          </p>

          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, teléfono o correo…"
            aria-label="Buscar contacto"
          />

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {searching && (
              <p className="p-2 text-sm text-muted-foreground">Buscando…</p>
            )}
            {!searching && term.length >= 2 && visibleHits.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">
                Ningún contacto coincide.
              </p>
            )}
            {visibleHits.map((contact) => (
              <button
                key={contact.id}
                type="button"
                disabled={linking !== null}
                onClick={() => void link(contact.id)}
                className="flex w-full flex-col rounded-md p-2 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span className="font-medium">
                  {contact.displayName ??
                    `${contact.firstName} ${contact.lastName ?? ""}`.trim()}
                </span>
                <span className="text-xs text-muted-foreground">
                  {contact.phoneE164}
                  {contact.email ? ` · ${contact.email}` : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LinkContactDialog;
