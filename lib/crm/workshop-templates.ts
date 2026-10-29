import { prisma } from "@/lib/db";

import { writeAuditLog } from "./audit";
import { createWhatsAppTemplate, metaTemplateName, STARTER_TEMPLATES, type StarterTemplate } from "./whatsapp-templates";
import {
  WORKSHOP_TEMPLATES,
  workshopTemplateSpec,
  workshopTemplateState,
  type StoredTemplate,
  type WorkshopTemplateSpec,
  type WorkshopTemplateState,
} from "./workshop-templates-rules";

/**
 * Las plantillas del taller en «Interesadas» (29-oct): cómo está cada una en
 * Meta y «Mandar a aprobar» (solo la dueña). Reglas y textos en
 * `workshop-templates-rules.ts`.
 *
 * El estado es el que guardó la última sincronización con 360dialog (al abrir
 * el taller, `ensureEventTemplatesSubmitted` → `refreshTemplatesIfPending`):
 * esta pantalla no le pregunta nada a 360dialog. Mandar a aprobar sí: va
 * directo a `createWhatsAppTemplate`, sin el tope de 30 min de
 * `ensureTemplatesSubmitted` (la dueña tocó el botón: tiene que salir ya).
 */

export type WorkshopTemplateView = WorkshopTemplateSpec & { state: WorkshopTemplateState };

type Deps = {
  /** Mandar la plantilla a Meta (en las pruebas, nada: la base de desarrollo tiene una clave de 360dialog real). */
  submitTemplate?: (t: StarterTemplate) => Promise<unknown>;
};

const storedFor = async (keys: string[]): Promise<Map<string, StoredTemplate>> => {
  const rows = await prisma.messageTemplate.findMany({
    where: { key: { in: keys }, metaTemplateName: { not: null } },
    select: { key: true, metaApprovalStatus: true, metaCategory: true },
  });
  return new Map(rows.map((r) => [r.key, { status: r.metaApprovalStatus, category: r.metaCategory }]));
};

/** Las dos plantillas del taller con su estado en Meta. */
export const listWorkshopTemplates = async (): Promise<WorkshopTemplateView[]> => {
  const stored = await storedFor(WORKSHOP_TEMPLATES.map((t) => t.key));
  return WORKSHOP_TEMPLATES.map((spec) => ({ ...spec, state: workshopTemplateState(spec, stored.get(spec.key) ?? null) }));
};

export type SubmitOutcome =
  | { key: string; status: "submitted" }
  | { key: string; status: "already"; state: WorkshopTemplateState }
  | { key: string; status: "failed"; error: string };

/**
 * Manda a aprobar las plantillas del taller que nunca se mandaron o que Meta
 * rechazó (todas, o las de `keys`). Cada intento queda en la auditoría
 * (`CREATE` de `WhatsAppTemplate`, como «Plantillas»), con quién, desde qué
 * taller y cómo terminó. Las que ya están en revisión o aprobadas no se tocan.
 */
export const submitWorkshopTemplates = async (
  input: { staffId: string | null; editionId?: string | null; keys?: string[]; via?: string },
  deps: Deps = {}
): Promise<SubmitOutcome[]> => {
  const keys = (input.keys ?? WORKSHOP_TEMPLATES.map((t) => t.key)).filter((k) => workshopTemplateSpec(k));
  if (keys.length === 0) return [];
  const stored = await storedFor(keys);
  const submit = deps.submitTemplate ?? ((t: StarterTemplate) => createWhatsAppTemplate(t));
  const out: SubmitOutcome[] = [];
  for (const key of keys) {
    const spec = workshopTemplateSpec(key)!;
    const state = workshopTemplateState(spec, stored.get(key) ?? null);
    if (!state.submittable) {
      out.push({ key, status: "already", state });
      continue;
    }
    const starter = STARTER_TEMPLATES.find((t) => t.key === key);
    if (!starter) {
      out.push({ key, status: "failed", error: "No está entre las plantillas recomendadas." });
      continue;
    }
    let outcome: SubmitOutcome;
    try {
      await submit(starter);
      outcome = { key, status: "submitted" };
    } catch (e) {
      outcome = { key, status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
    }
    out.push(outcome);
    await writeAuditLog({
      ...(input.staffId ? { staffUserId: input.staffId } : {}),
      action: "CREATE",
      entityType: "WhatsAppTemplate",
      entityId: metaTemplateName(key),
      changes: {
        key,
        category: starter.category,
        via: input.via ?? "taller",
        editionId: input.editionId ?? null,
        before: state.kind,
        result: outcome.status,
        ...(outcome.status === "failed" ? { error: outcome.error } : {}),
      },
    }).catch((e: unknown) => console.error(`[talleres] no se pudo auditar el envío de la plantilla ${key}`, e));
  }
  return out;
};
