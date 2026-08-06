import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import { ensureFreeWebinar } from "@/lib/crm/free-webinar";
import { getWorkshopEditionBySlug } from "@/lib/crm/workshop-editions";
import { prisma } from "@/lib/db";
import { resolveCountryIso } from "@/lib/datetime/resolve-country-iso";
import {
  formatInstantForContact,
  formatLocalClockTime,
  getSchedulePlaceLabel,
} from "@/lib/datetime/visitor-schedule";
import {
  getDateKeyInTz,
  isValidIanaTimeZone,
  zonedDateTimeToUtc,
} from "@/lib/datetime/zoned-time";
import {
  suggestTimezoneForCountryOrNull,
} from "@/lib/contact-timezone";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";

const targetSchema = z.object({
  countryIso: z
    .string()
    .length(2)
    .optional()
    .describe("ISO country code, e.g. JP, ES, CO"),
  countryName: z
    .string()
    .min(2)
    .max(80)
    .optional()
    .describe('Country in Spanish or English, e.g. "Japón", "Spain"'),
  timeZone: z
    .string()
    .min(3)
    .max(80)
    .optional()
    .describe("IANA zone if already known, e.g. Asia/Tokyo"),
});

const resolveTarget = (
  target: z.infer<typeof targetSchema>
):
  | { ok: true; countryIso: string | null; timeZone: string; place: string }
  | { ok: false; error: string } => {
  if (target.timeZone?.trim()) {
    const tz = target.timeZone.trim();
    if (!isValidIanaTimeZone(tz)) {
      return { ok: false, error: `Zona IANA inválida: ${tz}` };
    }
    const iso =
      target.countryIso?.toUpperCase() ??
      (target.countryName ? resolveCountryIso(target.countryName) : null);
    return {
      ok: true,
      countryIso: iso,
      timeZone: tz,
      place: getSchedulePlaceLabel(tz, iso),
    };
  }

  const iso =
    target.countryIso?.toUpperCase() ??
    (target.countryName ? resolveCountryIso(target.countryName) : null);

  if (!iso) {
    return {
      ok: false,
      error: `No pude identificar el país (${target.countryName ?? target.countryIso ?? "vacío"}). Usa un código ISO (JP, ES) o el nombre (Japón, España).`,
    };
  }

  const timeZone = suggestTimezoneForCountryOrNull(iso);
  if (!timeZone) {
    return {
      ok: false,
      error: `No hay zona horaria conocida para el país ${iso}.`,
    };
  }

  return {
    ok: true,
    countryIso: iso,
    timeZone,
    place: getSchedulePlaceLabel(timeZone, iso),
  };
};

type SourceInstant = {
  kind: "free_webinar" | "workshop" | "therapy_session" | "instant";
  label: string;
  startsAtIso: string;
  hasTime: boolean;
  sourceTimezone: string;
  daySchedule?: { startTime: string; endTime: string; title: string }[];
};

const loadSource = async (input: {
  source: "free_webinar" | "workshop" | "therapy_session" | "instant";
  workshopSlug?: string;
  therapySessionId?: string;
  startsAtIso?: string;
  hasTime?: boolean;
}): Promise<SourceInstant | { error: string }> => {
  const crmTz = await getOperationalTimezone();

  if (input.source === "free_webinar") {
    const webinar = await ensureFreeWebinar();
    if (!webinar.startsAtIso) {
      return { error: "El webinar gratuito aún no tiene fecha programada." };
    }
    return {
      kind: "free_webinar",
      label: webinar.headline,
      startsAtIso: webinar.startsAtIso,
      hasTime: webinar.startsAtHasTime,
      sourceTimezone: webinar.operationalTimezone || crmTz,
    };
  }

  if (input.source === "workshop") {
    if (!input.workshopSlug) {
      return { error: "Para un taller indica workshopSlug." };
    }
    const edition = await getWorkshopEditionBySlug(input.workshopSlug);
    if (!edition) return { error: `Taller no encontrado: ${input.workshopSlug}` };
    if (!edition.startsAt) {
      return {
        error: `El taller "${edition.title}" no tiene startsAt en UTC. Revisa la fecha en el CRM.`,
      };
    }
    const slots = Array.isArray(edition.daySchedule)
      ? (
          edition.daySchedule as {
            startTime?: string;
            endTime?: string;
            title?: string;
          }[]
        )
          .filter((s) => s.startTime && s.endTime)
          .map((s) => ({
            startTime: String(s.startTime),
            endTime: String(s.endTime),
            title: String(s.title ?? ""),
          }))
      : [];
    return {
      kind: "workshop",
      label: edition.title,
      startsAtIso: edition.startsAt.toISOString(),
      hasTime: true,
      sourceTimezone: edition.timezone || crmTz,
      daySchedule: slots.length ? slots : undefined,
    };
  }

  if (input.source === "therapy_session") {
    if (!input.therapySessionId) {
      return { error: "Para una sesión de terapia indica therapySessionId." };
    }
    const session = await prisma.therapySession.findUnique({
      where: { id: input.therapySessionId },
      include: {
        therapyPackage: {
          include: {
            enrollment: {
              include: {
                contact: {
                  select: {
                    displayName: true,
                    firstName: true,
                    timezone: true,
                    countryIso: true,
                  },
                },
                product: { select: { title: true } },
              },
            },
          },
        },
      },
    });
    if (!session) return { error: "Sesión de terapia no encontrada." };
    if (!session.scheduledAt) {
      return { error: "Esa sesión aún no tiene fecha/hora agendada." };
    }
    const contact = session.therapyPackage.enrollment.contact;
    const name = contact.displayName ?? contact.firstName;
    return {
      kind: "therapy_session",
      label: `Sesión ${session.sessionNumber} · ${name}`,
      startsAtIso: session.scheduledAt.toISOString(),
      hasTime: true,
      sourceTimezone: contact.timezone || crmTz,
    };
  }

  // instant
  if (!input.startsAtIso) {
    return { error: "Para source=instant indica startsAtIso (UTC ISO-8601)." };
  }
  const d = new Date(input.startsAtIso);
  if (Number.isNaN(d.getTime())) {
    return { error: "startsAtIso no es una fecha válida." };
  }
  return {
    kind: "instant",
    label: "Instante",
    startsAtIso: d.toISOString(),
    hasTime: input.hasTime !== false,
    sourceTimezone: crmTz,
  };
};

export default defineTool({
  description:
    "Convert a scheduled event (free webinar, workshop, therapy session, or raw UTC instant) into exact local date/time for one or more countries or IANA timezones. Use whenever the operator asks “qué hora sería en Japón/España/…” for a taller, webinar or sesión — never guess offsets mentally.",
  inputSchema: z.object({
    source: z
      .enum(["free_webinar", "workshop", "therapy_session", "instant"])
      .describe("Which event to convert"),
    workshopSlug: z
      .string()
      .min(1)
      .optional()
      .describe("Required when source=workshop"),
    therapySessionId: z
      .string()
      .min(1)
      .optional()
      .describe("Required when source=therapy_session"),
    startsAtIso: z
      .string()
      .datetime()
      .optional()
      .describe("Required when source=instant — UTC ISO-8601"),
    hasTime: z
      .boolean()
      .optional()
      .describe("For instant: false if date-only (time TBD)"),
    targets: z
      .array(targetSchema)
      .min(1)
      .max(12)
      .describe(
        'Countries or zones to convert to, e.g. [{ countryName: "Japón" }, { countryIso: "ES" }]'
      ),
    includeDaySchedule: z
      .boolean()
      .optional()
      .describe(
        "For workshops: also convert each daySchedule HH:mm slot into the target zone"
      ),
  }),
  async execute(input, ctx) {
    requireStaff(ctx);

    const source = await loadSource(input);
    if ("error" in source) {
      return { ok: false as const, error: source.error };
    }

    const conversions = input.targets.map((target) => {
      const resolved = resolveTarget(target);
      if (!resolved.ok) {
        return {
          ok: false as const,
          error: resolved.error,
          requested: target,
        };
      }

      const formatted = formatInstantForContact(source.startsAtIso, {
        timezone: resolved.timeZone,
        countryIso: resolved.countryIso,
      });

      let dayScheduleLocal:
        | {
            title: string;
            start: string;
            end: string;
            range: string;
          }[]
        | undefined;

      if (
        input.includeDaySchedule &&
        source.daySchedule?.length &&
        source.hasTime
      ) {
        try {
          const dateKey = getDateKeyInTz(
            new Date(source.startsAtIso),
            source.sourceTimezone
          );
          dayScheduleLocal = source.daySchedule.map((slot) => {
            const startUtc = zonedDateTimeToUtc(
              dateKey,
              slot.startTime,
              source.sourceTimezone
            );
            const endUtc = zonedDateTimeToUtc(
              dateKey,
              slot.endTime,
              source.sourceTimezone
            );
            const start = formatLocalClockTime(
              startUtc.toISOString(),
              resolved.timeZone
            );
            const end = formatLocalClockTime(
              endUtc.toISOString(),
              resolved.timeZone
            );
            return {
              title: slot.title,
              start,
              end,
              range: `${start} – ${end}`,
            };
          });
        } catch {
          dayScheduleLocal = undefined;
        }
      }

      const speakEs = source.hasTime
        ? `${source.label}: ${formatted.date}, ${formatted.timeWithPlace} (zona ${resolved.timeZone}).`
        : `${source.label}: ${formatted.date} (${formatted.place}) — la hora aún no está confirmada.`;

      return {
        ok: true as const,
        countryIso: resolved.countryIso,
        timeZone: resolved.timeZone,
        place: resolved.place,
        localDate: formatted.date,
        localTime: source.hasTime ? formatted.time : null,
        localDateTime: source.hasTime ? formatted.dateTime : formatted.date,
        timeWithPlace: source.hasTime ? formatted.timeWithPlace : null,
        dayScheduleLocal,
        speakEs,
      };
    });

    const crmFormatted = formatInstantForContact(source.startsAtIso, {
      timezone: source.sourceTimezone,
    });

    return {
      ok: true as const,
      source: {
        kind: source.kind,
        label: source.label,
        startsAtIso: source.startsAtIso,
        hasTime: source.hasTime,
        sourceTimezone: source.sourceTimezone,
        inSourceTimezone: source.hasTime
          ? `${crmFormatted.dateTime} · ${crmFormatted.place}`
          : `${crmFormatted.date} (sin hora confirmada)`,
      },
      conversions,
      tip: "Responde con el campo speakEs de cada conversión. No recalcules husos a mano.",
    };
  },
});
