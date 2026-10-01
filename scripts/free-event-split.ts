/**
 * Separa la edición pasada del evento gratuito que quedó mezclada en la viva
 * (lógica en `lib/crm/free-event-split.ts`).
 *
 * Simulación (por defecto, no escribe nada):
 *   bun scripts/free-event-split.ts --past-starts-at=2026-08-16T14:30:00Z \
 *     --past-meet-url=https://meet.google.com/xxx-xxxx-xxx --cutoff=2026-08-17T00:00:00Z
 *
 * Aplicar (escribe antes una copia en backups/):
 *   … --apply --confirm-live-id=<id de la fila «gratuito»>
 *
 * Deshacer:
 *   bun scripts/free-event-split.ts --rollback backups/free-event-split-<fecha>.json
 *
 * Opcionales: --past-no-time (la pasada no tenía hora), --reregistrants=<json>
 * (lista de contactIds o de { contactId, at }), --backup-dir=<carpeta>.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  freeEventSplit,
  planFreeEventSplit,
  applyFreeEventSplit,
  rollbackFreeEventSplit,
  splitBackupOf,
  type SplitBackup,
  type SplitParams,
} from "@/lib/crm/free-event-split";
import { FREE_WEBINAR_SLUG } from "@/lib/crm/free-webinar";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  const next = i >= 0 ? args[i + 1] : undefined;
  return next && !next.startsWith("--") ? next : undefined;
};
const has = (name: string) => args.includes(`--${name}`) || args.some((a) => a.startsWith(`--${name}=`));

const fail = (msg: string): never => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

const date = (name: string): Date => {
  const raw = flag(name) ?? fail(`Falta --${name}=<fecha ISO>`);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) fail(`--${name} no es una fecha válida: ${raw}`);
  return d;
};

const dbHost = () => {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(DATABASE_URL sin definir)";
  }
};

const fmt = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace(".000Z", "Z") : "—");

const main = async () => {
  console.log(`Base de datos: ${dbHost()}`);

  if (has("rollback")) {
    const file = flag("rollback") ?? fail("Uso: --rollback <archivo.json>");
    const backup = JSON.parse(readFileSync(resolve(file), "utf8")) as SplitBackup;
    console.log(`Deshaciendo con ${file} (${backup.rows.length} filas guardadas)…`);
    const r = await rollbackFreeEventSplit(backup);
    console.log(`✔ Restauradas ${r.restored}, copias borradas ${r.copiesDeleted}, edición pasada borrada: ${r.pastDeleted ? "sí" : "no"}`);
    return;
  }

  const reFile = flag("reregistrants");
  let reRegistrants: SplitParams["reRegistrants"];
  if (reFile) {
    const raw = JSON.parse(readFileSync(resolve(reFile), "utf8")) as (string | { contactId: string; at?: string })[];
    reRegistrants = raw.map((r) =>
      typeof r === "string" ? { contactId: r } : { contactId: r.contactId, at: r.at ? new Date(r.at) : null }
    );
  }
  const params: SplitParams = {
    pastStartsAt: date("past-starts-at"),
    pastStartsAtHasTime: !has("past-no-time"),
    pastMeetUrl: flag("past-meet-url") ?? fail("Falta --past-meet-url=<enlace de Meet de la edición pasada>"),
    cutoff: date("cutoff"),
    reRegistrants,
  };

  const plan = await planFreeEventSplit(params);
  if (plan.live.slug !== FREE_WEBINAR_SLUG) fail(`La fila viva no es «${FREE_WEBINAR_SLUG}» (${plan.live.slug}).`);
  console.log(`\nEdición viva: ${plan.live.id} (${plan.live.slug}) «${plan.live.headline}» · ${fmt(plan.live.startsAt)} · ${plan.live.total} inscritas`);
  console.log(
    `Edición pasada: ${plan.past.exists ? `ya existe (${plan.past.id})` : "se crea"} · ${fmt(plan.past.startsAt)} · ${plan.past.meetUrl}`
  );
  console.log(`Corte: ${fmt(params.cutoff)}`);
  console.log(`\nPasan a la edición pasada: ${plan.toMove.length}`);
  console.log(`Se volvieron a inscribir (copia en la pasada + fecha nueva en la viva): ${plan.reRegistrants.length}`);
  for (const r of plan.reRegistrants) {
    console.log(
      `  · ${r.name || "(sin nombre)"} ${r.phone} — inscrita ${fmt(r.registeredAt)}, de nuevo ${fmt(r.reRegisteredAt)}${r.alreadyOnPast ? " (ya estaba en la pasada)" : ""}`
    );
  }
  console.log(`Sellos de antes del corte que se quitan en la viva: ${plan.staleLiveStamps}`);
  console.log(`Quedan en la viva: ${plan.stayOnLive}`);

  if (!has("apply")) {
    console.log("\nSimulación: no se escribió nada. Para aplicar: --apply --confirm-live-id=" + plan.live.id);
    return;
  }
  if (flag("confirm-live-id") !== plan.live.id) {
    fail(`--confirm-live-id tiene que ser el id de la fila viva (${plan.live.id}).`);
  }
  if (plan.toMove.length === 0 && plan.reRegistrants.length === 0 && plan.past.exists) {
    console.log("\nNada que hacer: ya estaba separado.");
    return;
  }

  const dir = resolve(flag("backup-dir") ?? "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `free-event-split-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(splitBackupOf(plan), null, 2));
  console.log(`\nCopia de seguridad: ${file}`);

  const applied = await applyFreeEventSplit(plan);
  writeFileSync(file, JSON.stringify(splitBackupOf(plan, applied), null, 2));
  console.log(
    `✔ Hecho. Edición pasada ${applied.pastId}${applied.createdPast ? " (nueva)" : ""} · movidas ${applied.moved} · copias ${applied.copied} · fechas nuevas ${applied.liveRedated} · sellos quitados ${applied.stampsCleared}`
  );
  console.log(`Para deshacer: bun scripts/free-event-split.ts --rollback ${file}`);

  // Comprobación: una segunda pasada no debe encontrar nada.
  const again = await freeEventSplit(params);
  console.log(`Segunda pasada (simulada): ${again.plan.toMove.length} por mover, ${again.plan.reRegistrants.length} por copiar.`);
};

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
