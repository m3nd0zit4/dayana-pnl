"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";

export type SessionRow = {
  id: string;
  deviceLabel: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
  createdAt: string;
};

type ActiveSessionsTableProps = {
  sessions: SessionRow[];
  currentSessionId: string | null;
  /** Base path, e.g. "/api/miembros/cuenta/sesiones" — the row id + "/revocar" is appended client-side. */
  revokeUrlBase: string;
  revokeAllUrl: string;
  /** Where to land after "log out everywhere" signs the current device out too. */
  signInUrl: string;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

const ActiveSessionsTable = ({
  sessions,
  currentSessionId,
  revokeUrlBase,
  revokeAllUrl,
  signInUrl,
}: ActiveSessionsTableProps) => {
  const router = useRouter();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async (sessionId: string) => {
    setError(null);
    setRevokingId(sessionId);
    const res = await fetch(`${revokeUrlBase}/${sessionId}/revocar`, {
      method: "POST",
    });
    setRevokingId(null);
    if (!res.ok) {
      setError("No se pudo cerrar esa sesión. Intenta de nuevo.");
      return;
    }
    router.refresh();
  };

  const revokeAll = async () => {
    setError(null);
    setRevokingAll(true);
    const res = await fetch(revokeAllUrl, { method: "POST" });
    if (!res.ok) {
      setRevokingAll(false);
      setError("No se pudo cerrar las sesiones. Intenta de nuevo.");
      return;
    }
    // Revokes the current session too — sign out locally and land back on sign-in.
    await signOut({ callbackUrl: signInUrl });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Dispositivos con sesión activa en tu cuenta.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={revokingAll}
          onClick={revokeAll}
        >
          {revokingAll ? "Cerrando…" : "Cerrar todo"}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dispositivo</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Creada</TableHead>
              <TableHead>Última actividad</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium whitespace-nowrap">
                  {s.deviceLabel ?? "Dispositivo desconocido"}
                  {s.id === currentSessionId && (
                    <Badge variant="secondary" className="ml-2">
                      Actual
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {s.ipAddress ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatDate(s.createdAt)}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatDate(s.lastSeenAt)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {s.id !== currentSessionId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={revokingId === s.id}
                      onClick={() => revoke(s.id)}
                    >
                      {revokingId === s.id ? "Cerrando…" : "Cerrar sesión"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default ActiveSessionsTable;
