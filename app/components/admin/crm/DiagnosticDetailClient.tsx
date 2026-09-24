"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { diagnosticSourceLabel } from "@/lib/crm/diagnostic-answers";
import type { DiagnosticDetail } from "@/lib/crm/diagnostics";
import { PROFILE_SHORT_LABEL } from "@/lib/diagnostico/profiles";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { trackStaffWhatsApp } from "./trackStaffWhatsApp";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import { CrmPublicLink } from "./ui";

/**
 * Fechas con la zona operativa fija, no la del navegador: el servidor de
 * Vercel corre en UTC y el navegador de Dayana en Bogotá, y formatear sin
 * `timeZone` daba un HTML distinto en cada lado (error de hidratación).
 */
const formatDateTime = (iso: string | null, timeZone: string): string | null =>
  iso
    ? new Date(iso).toLocaleString("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      })
    : null;

type TimelineStep = {
  label: string;
  at: string | null;
};

/**
 * Estilo "respuesta única" de Formbricks: una línea por paso, atenuada si
 * todavía no pasó. No hay indicador de progreso — el embudo del diagnóstico
 * no tiene pasos opcionales que se puedan saltar fuera de orden, así que
 * basta con la fecha o su ausencia.
 */
const TimelineList = ({ steps, timeZone }: { steps: TimelineStep[]; timeZone: string }) => (
  <ol className="space-y-3">
    {steps.map((step) => {
      const when = formatDateTime(step.at, timeZone);
      return (
        <li key={step.label} className="flex items-baseline justify-between gap-3 text-sm">
          <span className={when ? undefined : "text-muted-foreground"}>{step.label}</span>
          <span className={when ? "text-muted-foreground" : "text-muted-foreground/60 italic"}>
            {when ?? "Todavía no"}
          </span>
        </li>
      );
    })}
  </ol>
);

/**
 * Una respuesta se pinta como texto libre — no como badges — cuando es una
 * sola frase larga: es la forma de reconocer un campo de texto sin que
 * `DiagnosticAnswerItem` tenga que cargar el tipo de pregunta (la interfaz es
 * compartida con la tarjeta de la ficha de contacto). El cuestionario actual
 * no tiene ningún campo de texto libre, pero uno viejo sí podría, y esto
 * evita una badge kilométrica.
 */
const isFreeTextAnswer = (answers: string[]) => answers.length === 1 && answers[0].length > 40;

const AnswerItemRow = ({
  item,
}: {
  item: DiagnosticDetail["answers"][number];
}) => (
  <div className="space-y-1">
    <p className="text-sm font-medium">{item.question}</p>
    {item.answers.length === 0 ? (
      <p className="text-sm text-muted-foreground">Sin responder</p>
    ) : isFreeTextAnswer(item.answers) ? (
      <p className="text-sm">{item.answers[0]}</p>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {item.answers.map((label) => (
          <Badge key={label} variant="secondary">
            {label}
          </Badge>
        ))}
      </div>
    )}
    {item.hint ? <p className="text-xs text-muted-foreground">{item.hint}</p> : null}
  </div>
);

type Props = {
  diagnostic: DiagnosticDetail;
  /** Zona operativa (ajustes del sitio), resuelta en el servidor. */
  timeZone: string;
  /** Lectura de la IA y el primer WhatsApp (se arma en el servidor). */
  outreach?: React.ReactNode;
};

/**
 * Ficha de un diagnóstico — qué contestó, cuándo, y qué tan lejos llegó en el
 * embudo. Al estilo de una respuesta individual de Formbricks: resumen
 * arriba, línea de tiempo, y todas las respuestas debajo, sin pestañas.
 */
const DiagnosticDetailClient = ({ diagnostic, timeZone, outreach }: Props) => {
  const contact = diagnostic.contact;
  const whatsAppUrl = contact?.phoneE164
    ? buildContactWhatsAppUrl(contact.phoneE164)
    : null;

  const steps: TimelineStep[] = [
    { label: "Empezó", at: diagnostic.createdAt },
    { label: "Terminó", at: diagnostic.completedAt },
    { label: "Vio el resultado", at: diagnostic.viewedResultAt },
    { label: "Pulsó «Hablar con Dayana»", at: diagnostic.checkoutStartedAt },
    { label: "Fue a WhatsApp (última vez)", at: diagnostic.whatsappLeadAt },
    { label: "Le escribiste por WhatsApp", at: diagnostic.whatsappStaffAt },
  ];

  const completedLabel = formatDateTime(diagnostic.completedAt, timeZone);

  return (
    <CrmPageShell>
      <CrmPageHeader
        title={contact?.name || "Diagnóstico anónimo"}
        description={
          diagnostic.profileName && completedLabel
            ? `${diagnostic.profileName} · terminado el ${completedLabel}`
            : (diagnostic.profileName ?? undefined)
        }
        backHref="/admin/diagnosticos"
        backLabel="Diagnósticos"
        secondaryActions={
          <>
            {whatsAppUrl ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={whatsAppUrl} target="_blank" rel="noopener noreferrer" onClick={() => contact && trackStaffWhatsApp(contact.id, "crm_diagnostic", diagnostic.id)} />}
              >
                <MessageCircle aria-hidden />
                WhatsApp
              </Button>
            ) : null}
            {/* Abrirlo desde aquí no cuenta como visita de la persona: la
                página pública no sella nada cuando quien mira es del equipo. */}
            <CrmPublicLink
              href={`/terapias/resultado/${diagnostic.token}`}
              label="Ver resultado"
            />
          </>
        }
      />

      {outreach}

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {diagnostic.profile ? (
              <Badge variant="secondary">{PROFILE_SHORT_LABEL[diagnostic.profile]}</Badge>
            ) : null}
            {diagnostic.isCustomer ? <Badge variant="secondary">Ya es cliente</Badge> : null}
            {contact ? (
              <Link
                href={`/admin/contacts/${contact.id}`}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Ver contacto
              </Link>
            ) : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Compromiso</dt>
              <dd className="mt-0.5 font-medium">
                {diagnostic.commitmentScore != null ? `${diagnostic.commitmentScore}/10` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Urgencia</dt>
              <dd className="mt-0.5 font-medium">
                {diagnostic.urgencyScore != null ? `${diagnostic.urgencyScore}/10` : "—"}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Proceso recomendado</dt>
              <dd className="mt-0.5 font-medium break-words">
                {diagnostic.recommendedProductTitle ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Origen</dt>
              <dd className="mt-0.5">{diagnosticSourceLabel(diagnostic.source) ?? "—"}</dd>
            </div>
            {contact?.email ? (
              <div>
                <dt className="text-xs text-muted-foreground">Correo</dt>
                <dd className="mt-0.5 break-words">{contact.email}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-sm font-semibold">Recorrido</h2>
          <TimelineList steps={steps} timeZone={timeZone} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-sm font-semibold">Respuestas</h2>
          {diagnostic.answers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este diagnóstico no tiene respuestas guardadas.
            </p>
          ) : (
            <div className="space-y-4">
              {diagnostic.answers.map((item) => (
                <AnswerItemRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </CrmPageShell>
  );
};

export default DiagnosticDetailClient;
