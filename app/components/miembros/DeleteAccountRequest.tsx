"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";

/**
 * Two-step "request account deletion" control. The request only marks the
 * contact for staff to process in the CRM — nothing is deleted immediately,
 * so the member keeps access until staff completes it.
 */
const DeleteAccountRequest = () => {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const res = await fetch("/api/miembros/cuenta/eliminar", {
      method: "POST",
    });
    setLoading(false);

    if (!res.ok) {
      setError("No se pudo enviar la solicitud. Intenta de nuevo.");
      return;
    }
    setDone(true);
    setConfirming(false);
  };

  if (done) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Solicitud enviada. Procesaremos la eliminación de tu cuenta y tus
        datos; te contactaremos si necesitamos confirmar algo.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Si quieres que eliminemos tu cuenta y tus datos, envía una solicitud.
        La procesamos manualmente y perderás acceso a tus compras.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={loading}
            onClick={submit}
          >
            {loading ? "Enviando…" : "Sí, solicitar eliminación"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => setConfirming(false)}
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(true)}
        >
          Solicitar eliminación de cuenta
        </Button>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default DeleteAccountRequest;
