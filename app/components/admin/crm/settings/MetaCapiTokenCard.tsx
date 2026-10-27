"use client";

import { useState } from "react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import type { CapiTokenStatus } from "@/lib/meta/capi-credentials";

type ApiBody = {
  status?: CapiTokenStatus;
  check?: "valid" | "invalid" | "unknown";
  message?: string | null;
  error?: string;
};

const savedOn = (iso: string | null): string | null =>
  iso
    ? new Date(iso).toLocaleDateString("es-CO", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "America/Bogota",
      })
    : null;

/**
 * Token de Meta para contar las compras en los anuncios.
 *
 * El campo es de solo escritura: el token se pega, se guarda cifrado y no se
 * vuelve a mostrar; el panel solo enseña su huella para saber cuál está
 * puesto. Si Meta lo rechaza no se guarda.
 */
const MetaCapiTokenCard = ({ initial }: { initial: CapiTokenStatus }) => {
  const { toast } = useCrm();
  const [status, setStatus] = useState(initial);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "remove">(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Meta no pudo comprobar el token y ya hay otro en uso: el siguiente
  // «Guardar» es una confirmación explícita.
  const [forceNext, setForceNext] = useState(false);

  const call = async (method: "PUT" | "POST" | "DELETE", body?: unknown) => {
    try {
      const res = await fetch("/api/admin/settings/meta-capi", {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as ApiBody;
      return { ok: res.ok, data };
    } catch {
      return {
        ok: false,
        data: { message: "Sin conexión: no se hizo ningún cambio." } as ApiBody,
      };
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      const { ok, data } = await call("PUT", { token, force: forceNext });
      if (data.error === "unverified") {
        setForceNext(true);
        toast(data.message ?? "No pude comprobar el token con Meta.", "info");
        return;
      }
      if (!ok || !data.status) {
        toast(data.message ?? "No se pudo guardar el token.", "error");
        return;
      }
      setStatus(data.status);
      setToken("");
      setForceNext(false);
      toast(
        data.check === "valid"
          ? "Token guardado. Meta lo reconoce."
          : "Token guardado, pero no pude comprobarlo con Meta. Pruébalo en un rato.",
        data.check === "valid" ? "success" : "info"
      );
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const { ok, data } = await call("POST", { action: "test" });
      if (!ok) {
        toast(
          data.error === "no_pixel"
            ? "Falta el id del píxel en el servidor."
            : "No hay token que probar.",
          "error"
        );
        return;
      }
      if (data.check === "valid") toast("Meta reconoce el token.", "success");
      else toast(data.message ?? "No pude comprobarlo.", data.check === "invalid" ? "error" : "info");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      const { ok, data } = await call("DELETE");
      if (!ok || !data.status) {
        toast("No se pudo quitar el token.", "error");
        return;
      }
      setStatus(data.status);
      setConfirmRemove(false);
      toast(
        data.status.source === "env"
          ? "Quitado. Se usa el token del servidor."
          : "Token quitado.",
        "success"
      );
    } finally {
      setBusy(null);
    }
  };

  const savedHere = status.source === "db";
  // Una fila que no se puede leer también se puede quitar.
  const canRemove = savedHere || status.storedUnreadable;
  const date = savedOn(status.savedAt);

  return (
    <Card>
      <CardContent className="space-y-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">Token de Meta para las compras</p>
            <p className="text-sm text-muted-foreground">
              Le dice a Meta qué compras salieron de tus anuncios. Sin un token
              que funcione, las compras dejan de contarse.
            </p>
          </div>
          {status.source === null ? (
            <Badge className="border-warning/40 bg-warning/10 text-warning">
              Sin token
            </Badge>
          ) : (
            <Badge className="border-success/40 bg-success/10 text-success">
              {savedHere ? "Guardado aquí" : "Usando el del servidor"}
            </Badge>
          )}
        </div>

        {!status.pixelConfigured && (
          <p className="text-sm text-warning">
            Falta el id del píxel en el servidor (NEXT_PUBLIC_META_PIXEL_ID).
            Aunque pegues el token, no se enviará nada hasta que esté.
          </p>
        )}

        {status.storedUnreadable && (
          <p className="text-sm text-warning">
            Hay un token guardado aquí que no se puede leer (casi siempre
            porque cambió la clave de cifrado del servidor). No se está usando.
            Pega uno nuevo o quita el guardado.
          </p>
        )}

        {status.source !== null && (
          <p className="text-xs text-muted-foreground">
            Token puesto: huella {status.fingerprint}
            {savedHere && date ? ` · guardado el ${date}` : ""}
            {savedHere && status.envTokenPresent
              ? ". El servidor también tiene uno, pero se usa este."
              : ""}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="meta-capi-token">
            {status.source === null ? "Token" : "Reemplazar el token"}
          </Label>
          <Input
            id="meta-capi-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setForceNext(false);
            }}
            placeholder="Pégalo desde Meta"
          />
          <p className="text-[11px] text-muted-foreground">
            En Meta: Administrador de eventos → tu conjunto de datos →
            Configuración → API de conversiones → Generar token de acceso. Se
            guarda cifrado y no se vuelve a mostrar.
          </p>
          <p className="text-[11px] text-muted-foreground">
            «Probar» solo confirma que Meta reconoce el token. Que las compras
            lleguen a tu píxel se ve en el Administrador de eventos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void save()}
            disabled={busy !== null || token.trim() === ""}
          >
            {busy === "save"
              ? "Guardando…"
              : forceNext
                ? "Guardar de todos modos"
                : "Guardar token"}
          </Button>

          {status.source !== null && (
            <Button
              variant="outline"
              onClick={() => void test()}
              disabled={busy !== null}
            >
              {busy === "test" ? "Probando…" : "Probar con Meta"}
            </Button>
          )}

          {canRemove &&
            (confirmRemove ? (
              <>
                <Button
                  variant="destructive"
                  onClick={() => void remove()}
                  disabled={busy !== null}
                >
                  {busy === "remove" ? "Quitando…" : "Sí, quitar"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmRemove(false)}
                  disabled={busy !== null}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setConfirmRemove(true)}
                disabled={busy !== null}
              >
                Quitar token
              </Button>
            ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default MetaCapiTokenCard;
