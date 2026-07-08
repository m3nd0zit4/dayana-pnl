"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { LiveClassSession } from "@prisma/client";
import {
  isRecordingVisible,
  recordingDaysLeft,
} from "@/lib/lms/course-content";
import DriveRecordingEmbed from "@/app/components/miembros/DriveRecordingEmbed";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";

const formatDateTime = (date: Date) =>
  `${date.toLocaleDateString("es-CO", { dateStyle: "full" })} · ${date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;

const formatDate = (date: Date) =>
  date.toLocaleDateString("es-CO", { dateStyle: "long" });

const ClassesList = ({
  upcoming,
  past,
  now,
  isCurrent,
}: {
  upcoming: LiveClassSession[];
  past: LiveClassSession[];
  now: Date;
  isCurrent: boolean;
}) => {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (cls: LiveClassSession) => !q || cls.title.toLowerCase().includes(q);
  const filteredUpcoming = upcoming.filter(matches);
  const filteredPast = past.filter(matches);

  return (
    <>
      {upcoming.length + past.length > 3 && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar clase…"
            className="pl-9"
          />
        </div>
      )}

      <section>
        <h2 className="mb-3 text-[11px] text-muted-foreground uppercase tracking-wide">
          Próximas
        </h2>
        {filteredUpcoming.length > 0 ? (
          <ul className="space-y-3">
            {filteredUpcoming.map((cls) => (
              <li key={cls.id}>
                <Card>
                  <CardContent>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-base font-semibold">{cls.title}</div>
                        {cls.scheduledAt ? (
                          <div className="mt-1 text-sm text-muted-foreground">
                            {formatDateTime(cls.scheduledAt)}
                          </div>
                        ) : null}
                        {cls.description ? (
                          <p className="mt-2 max-w-xl text-sm leading-relaxed">
                            {cls.description}
                          </p>
                        ) : null}
                      </div>
                      {isCurrent && cls.meetUrl ? (
                        <Button nativeButton={false} render={<a href={cls.meetUrl} target="_blank" rel="noopener noreferrer" />}>
                          Google Meet
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {q ? `Sin resultados para «${query}».` : "No hay clases programadas por ahora."}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[11px] text-muted-foreground uppercase tracking-wide">
          Grabaciones
        </h2>
        {filteredPast.length > 0 ? (
          <ul className="space-y-4">
            {filteredPast.map((cls) => {
              const visible = isRecordingVisible(cls, now);
              return (
                <li key={cls.id}>
                  <Card>
                    <CardContent>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <span className="text-base font-semibold">{cls.title}</span>
                          {cls.scheduledAt ? (
                            <span className="ml-3 text-xs text-muted-foreground">
                              {formatDate(cls.scheduledAt)}
                            </span>
                          ) : null}
                        </div>
                        {visible && cls.recordingPostedAt ? (
                          <Badge className="bg-accent/40 text-primary">
                            {recordingDaysLeft(cls.recordingPostedAt, now)} días más
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-3">
                        {visible ? (
                          isCurrent ? (
                            <DriveRecordingEmbed url={cls.recordingUrl!} title={cls.title} />
                          ) : (
                            <p className="text-sm">
                              Grabación disponible — renueva tu mensualidad para
                              verla.
                            </p>
                          )
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {cls.recordingUrl || cls.recordingHiddenAt
                              ? "La grabación de esta clase ya no está disponible (las grabaciones duran un mes)."
                              : "Esta clase no tiene grabación disponible."}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {q ? `Sin resultados para «${query}».` : "Aquí aparecerán las grabaciones de las clases pasadas."}
          </p>
        )}
      </section>
    </>
  );
};

export default ClassesList;
