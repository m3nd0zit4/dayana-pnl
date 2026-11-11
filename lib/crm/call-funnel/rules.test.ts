import { describe, expect, test } from "bun:test";

import {
  attributionFromUrl,
  buildIcs,
  cleanSocial,
  channelOf,
  cleanTimezone,
  confirmMessage,
  contactSourceFor,
  EMPTY_ATTRIBUTION,
  googleCalendarUrl,
  hasAttribution,
  isOfferedSlot,
  needsFollowUp,
  parseAnswersBody,
  parseAttribution,
  parseFunnelConfig,
  parseStartBody,
  pickFunnelSlots,
  readAnswers,
  sourceDetailFor,
  stageOf,
  type FunnelSlot,
} from "./rules";

const start = (over: Record<string, unknown> = {}) => ({
  firstName: "Ana",
  phone: "300 123 4567",
  phoneCountry: "co",
  consentData: true,
  timezone: "America/Bogota",
  ...over,
});

describe("paso 1: datos", () => {
  test("acepta lo mínimo y normaliza", () => {
    const parsed = parseStartBody(start());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.phoneCountry).toBe("CO");
    expect(parsed.value.consentMarketing).toBe(false);
    expect(parsed.value.timezone).toBe("America/Bogota");
    expect(parsed.value.attribution).toEqual(EMPTY_ATTRIBUTION);
  });

  test("sin permiso de datos no pasa", () => {
    expect(parseStartBody(start({ consentData: false }))).toEqual({ ok: false, error: "consent_required" });
    expect(parseStartBody(start({ consentData: "true" }))).toEqual({ ok: false, error: "consent_required" });
  });

  test("la trampa para bots gana sobre todo lo demás", () => {
    expect(parseStartBody(start({ hp: "http://spam" }))).toEqual({ ok: false, error: "honeypot" });
  });

  test("nombre y teléfono obligatorios; un enlace no es un nombre", () => {
    expect(parseStartBody(start({ firstName: " " }))).toEqual({ ok: false, error: "name_required" });
    expect(parseStartBody(start({ firstName: "www.gana-plata.com" }))).toEqual({ ok: false, error: "name_required" });
    expect(parseStartBody(start({ phone: "123" }))).toEqual({ ok: false, error: "phone_required" });
    expect(parseStartBody(null)).toEqual({ ok: false, error: "invalid" });
  });

  test("el marketing solo con un true de verdad", () => {
    const parsed = parseStartBody(start({ consentMarketing: true }));
    expect(parsed.ok && parsed.value.consentMarketing).toBe(true);
  });

  test("un nombre con cifras o «+» no pasa (va al título del evento y de ahí se lee un teléfono)", () => {
    expect(parseStartBody(start({ firstName: "Ana +573001112222" }))).toEqual({ ok: false, error: "name_required" });
    expect(parseStartBody(start({ firstName: "Ana 2" }))).toEqual({ ok: false, error: "name_required" });
    const parsed = parseStartBody(start({ lastName: "Pérez 300" }));
    expect(parsed.ok && parsed.value.lastName).toBeNull();
  });

  test("una zona horaria inventada no se guarda", () => {
    expect(cleanTimezone("America/Mexico_City")).toBe("America/Mexico_City");
    expect(cleanTimezone("Marte/Olympus")).toBeNull();
    expect(cleanTimezone("<script>")).toBeNull();
    expect(cleanTimezone(42)).toBeNull();
  });
});

describe("de dónde llegó", () => {
  test("lee la URL de un anuncio", () => {
    const a = attributionFromUrl("?utm_source=instagram&utm_campaign=reel-ansiedad&fbclid=abc", "https://l.instagram.com/", "/llamada");
    expect(a.utmSource).toBe("instagram");
    expect(a.utmCampaign).toBe("reel-ansiedad");
    expect(a.fbclid).toBe("abc");
    expect(a.landingPath).toBe("/llamada");
    expect(hasAttribution(a)).toBe(true);
  });

  test("sin nada en la URL no hay atribución (aunque haya referente)", () => {
    expect(hasAttribution(attributionFromUrl("", "https://www.google.com/", "/llamada"))).toBe(false);
  });

  test("recorta y limpia lo que llega", () => {
    const a = parseAttribution({ utmSource: `ig\u0000${"x".repeat(500)}`, ref: 7 });
    expect(a.utmSource?.length).toBe(80);
    expect(a.utmSource).not.toContain("\u0000");
    expect(a.ref).toBeNull();
  });

  test("el canal: lo que diga la URL manda sobre el clic del anuncio", () => {
    const of = (over: Partial<typeof EMPTY_ATTRIBUTION>) => channelOf({ ...EMPTY_ATTRIBUTION, ...over });
    expect(of({ utmSource: "tiktok" })).toBe("tiktok");
    expect(of({ ttclid: "x" })).toBe("tiktok");
    expect(of({ utmSource: "ig", fbclid: "x" })).toBe("instagram");
    expect(of({ fbclid: "x" })).toBe("facebook");
    expect(of({ ref: "enlaces" })).toBe("enlaces");
    expect(of({ referrer: "https://l.instagram.com/?u=x" })).toBe("instagram");
    expect(of({ referrer: "https://www.google.com/" })).toBe("google");
    expect(of({ referrer: "https://otro-sitio.com/post" })).toBe("otro");
    expect(of({ referrer: "https://www.dayanabeltran.com/" })).toBe("sitio");
    expect(of({})).toBe("sitio");
    // «digital» no es Instagram por contener «ig».
    expect(of({ utmSource: "digital" })).toBe("sitio");
  });

  test("el origen del contacto y su detalle", () => {
    const a = { ...EMPTY_ATTRIBUTION, utmSource: "tiktok", utmCampaign: "video-1" };
    expect(contactSourceFor(a)).toBe("TIKTOK");
    expect(contactSourceFor({ ...EMPTY_ATTRIBUTION, fbclid: "x" })).toBe("WEB_LEAD_FORM");
    expect(sourceDetailFor(a)).toBe("Llamada gratis en la web (TikTok · campaña video-1)");
    expect(sourceDetailFor(EMPTY_ATTRIBUTION)).toBe("Llamada gratis en la web (El sitio)");
  });
});

describe("paso 2: preguntas", () => {
  test("solo las opciones que existen", () => {
    expect(parseAnswersBody({ topic: "ansiedad", urgency: "ya" }).ok).toBe(true);
    expect(parseAnswersBody({ topic: "hackear", urgency: "ya" }).ok).toBe(false);
    expect(parseAnswersBody({ topic: "ansiedad" }).ok).toBe(false);
  });

  test("la nota se recorta y un correo malo se ignora sin fallar", () => {
    const parsed = parseAnswersBody({ topic: "duelo", urgency: "mes", note: "x".repeat(900), email: "no-es-correo" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.note?.length).toBe(500);
    expect(parsed.value.email).toBeNull();
    expect(parseAnswersBody({ topic: "duelo", urgency: "mes", email: " Ana@Correo.com " })).toMatchObject({
      ok: true,
      value: { email: "ana@correo.com" },
    });
  });

  test("redes: solo una cuenta, nunca un enlace cualquiera", () => {
    expect(cleanSocial("@dayana.pnl")).toBe("@dayana.pnl");
    expect(cleanSocial("tiktok.com/@dayanapnl")).toBe("@dayanapnl (TikTok)");
    expect(cleanSocial("https://spam.example/x")).toBeNull();
    expect(cleanSocial("<script>")).toBeNull();
  });

  test("una opción que no existe en las preguntas nuevas se ignora sin fallar", () => {
    const parsed = parseAnswersBody({ topic: "ansiedad", urgency: "mes", goal: "hackear", invest: 5 });
    expect(parsed.ok && [parsed.value.goal, parsed.value.invest]).toEqual([null, null]);
  });

  test("lo guardado se vuelve a leer igual", () => {
    // Una fila de antes (tema que ya no se ofrece, sin las preguntas nuevas) se sigue leyendo.
    expect(readAnswers({ topic: "dinero", urgency: "explorando", note: null })).toEqual({
      topic: "dinero",
      urgency: "explorando",
      goal: null,
      invest: null,
      occupation: null,
      social: null,
      note: null,
    });
    expect(
      readAnswers({ topic: "agotamiento", goal: "marca", urgency: "ya", invest: "depende", occupation: "Contadora", social: "https://www.instagram.com/ana.pnl/" })
    ).toMatchObject({ goal: "marca", invest: "depende", occupation: "Contadora", social: "@ana.pnl (Instagram)" });
    expect(readAnswers(null)).toBeNull();
    expect(readAnswers({ topic: "x" })).toBeNull();
  });
});

const slot = (dateKey: string, hm: string): FunnelSlot => {
  const startIso = new Date(`${dateKey}T${hm}:00-05:00`).toISOString();
  return { startIso, endIso: new Date(Date.parse(startIso) + 15 * 60_000).toISOString(), dateKey };
};

describe("paso 3: horas", () => {
  const day1 = ["08:00", "08:30", "09:00", "09:30", "10:00", "14:00", "15:00", "17:30"].map((hm) => slot("2026-11-11", hm));
  const day2 = ["09:00", "10:00"].map((hm) => slot("2026-11-12", hm));
  const day3 = ["16:00"].map((hm) => slot("2026-11-13", hm));
  const day4 = ["11:00"].map((hm) => slot("2026-11-16", hm));
  const all = [...day3, ...day1, ...day4, ...day2];

  test("los primeros días con cupo, repartidos en el día", () => {
    const picked = pickFunnelSlots(all, { days: 3, perDay: 4 });
    expect(picked.map((s) => s.dateKey)).toEqual(["2026-11-11", "2026-11-11", "2026-11-11", "2026-11-11", "2026-11-12", "2026-11-12", "2026-11-13"]);
    // La primera y la última del día siempre están.
    expect(picked[0].startIso).toBe(day1[0].startIso);
    expect(picked[3].startIso).toBe(day1[7].startIso);
  });

  test("un día con el tope de llamadas no se ofrece, y el siguiente ocupa su lugar", () => {
    const picked = pickFunnelSlots(all, { days: 2, perDay: 6, fullDays: new Set(["2026-11-11"]) });
    expect([...new Set(picked.map((s) => s.dateKey))]).toEqual(["2026-11-12", "2026-11-13"]);
  });

  test("solo se agenda una hora que se está ofreciendo", () => {
    expect(isOfferedSlot(day2[0].startIso, day2)).toBe(true);
    // El mismo instante escrito de otra forma también vale.
    expect(isOfferedSlot("2026-11-12T09:00:00-05:00", day2)).toBe(true);
    expect(isOfferedSlot("2026-11-12T09:15:00-05:00", day2)).toBe(false);
    expect(isOfferedSlot("mañana", day2)).toBe(false);
  });
});

describe("en qué va la persona", () => {
  const now = new Date("2026-11-11T15:00:00Z");
  const booking = (startsAt: string, status = "BOOKED") => ({
    startsAt: new Date(startsAt),
    endsAt: new Date(Date.parse(startsAt) + 15 * 60_000),
    status,
  });
  const base = { answeredAt: null, cancelledAt: null, booking: null, callOutcome: null, now };

  test("sin cita: datos o preguntas", () => {
    expect(stageOf(base)).toBe("datos");
    expect(stageOf({ ...base, answeredAt: now })).toBe("preguntas");
  });

  test("con cita por delante", () => {
    expect(stageOf({ ...base, booking: booking("2026-11-12T15:00:00Z") })).toBe("agendada");
    // Mientras la llamada está en curso sigue siendo «agendada».
    expect(stageOf({ ...base, booking: booking("2026-11-11T14:55:00Z") })).toBe("agendada");
  });

  test("la cita ya pasó: lo que se sepa de la llamada", () => {
    const past = booking("2026-11-10T15:00:00Z");
    expect(stageOf({ ...base, booking: past })).toBe("pasada");
    expect(stageOf({ ...base, booking: past, callOutcome: "answered" })).toBe("hablaron");
    expect(stageOf({ ...base, booking: past, callOutcome: "no_answer" })).toBe("no_contesto");
  });

  test("cancelada: por la persona o porque Dayana borró el evento", () => {
    expect(stageOf({ ...base, cancelledAt: now, booking: booking("2026-11-12T15:00:00Z", "CANCELLED") })).toBe("cancelada");
    expect(stageOf({ ...base, booking: booking("2026-11-12T15:00:00Z", "CANCELLED") })).toBe("cancelada");
  });

  test("canceló y volvió a agendar: manda la cita viva", () => {
    expect(stageOf({ ...base, cancelledAt: now, booking: booking("2026-11-12T15:00:00Z") })).toBe("agendada");
  });

  test("a quién hacerle seguimiento", () => {
    expect(["datos", "preguntas", "cancelada"].every((s) => needsFollowUp(s as never))).toBe(true);
    expect(["agendada", "hablaron", "no_contesto", "pasada"].some((s) => needsFollowUp(s as never))).toBe(false);
  });
});

describe("su página", () => {
  const startIso = "2026-11-12T21:15:00.000Z";
  const endIso = "2026-11-12T21:30:00.000Z";

  test("el mensaje de confirmación lleva SU hora", () => {
    const bogota = confirmMessage("Ana", startIso, "America/Bogota");
    expect(bogota).toContain("Ana");
    expect(bogota).toContain("jueves");
    expect(bogota).toContain("4:15");
    expect(confirmMessage("Ana", startIso, "Europe/Madrid")).toContain("10:15");
    // Si su zona no es la de Dayana, también la hora de Colombia (quien lee es Dayana).
    const both = confirmMessage("Ana", startIso, "Europe/Madrid", "America/Bogota");
    expect(both).toContain("10:15");
    expect(both).toContain("4:15");
    expect(both).toContain("hora de Colombia");
    expect(confirmMessage("Ana", startIso, "America/Bogota", "America/Bogota")).not.toContain("hora de Colombia");
  });

  test("el .ics es válido y avisa antes", () => {
    const ics = buildIcs({ uid: "b1", startIso, endIso, now: new Date("2026-11-10T00:00:00Z"), url: "https://www.dayanabeltran.com/llamada/tok" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261112T211500Z");
    expect(ics).toContain("DTEND:20261112T213000Z");
    expect(ics).toContain("UID:b1@dayanabeltran.com");
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    // Las comas del texto van escapadas (si no, el calendario corta la descripción).
    expect(ics).not.toMatch(/DESCRIPTION:[^\r\n]*[^\\],/);
  });

  test("el enlace de Google Calendar lleva las dos horas en UTC", () => {
    const url = new URL(googleCalendarUrl({ startIso, endIso, url: "https://x.test/llamada/tok" }));
    expect(url.searchParams.get("dates")).toBe("20261112T211500Z/20261112T213000Z");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
  });
});

describe("ajustes", () => {
  test("valores de siempre, y cada clave se arregla sola", () => {
    expect(parseFunnelConfig(null)).toEqual({ enabled: true, days: 3, perDay: 6, bookingsPerIpPerDay: 2 });
    expect(parseFunnelConfig({ enabled: false, days: 99, perDay: "cuatro", bookingsPerIpPerDay: 0 })).toEqual({
      enabled: false,
      days: 7,
      perDay: 6,
      bookingsPerIpPerDay: 1,
    });
  });
});
