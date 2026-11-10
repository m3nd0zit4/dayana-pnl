# Embudo de la llamada gratis (`/llamada`)

De un clic en redes a una llamada agendada con Dayana, sin pasar por un ida y
vuelta en WhatsApp. Este documento es el contrato entre las piezas: páginas
públicas, API, lógica y CRM.

## Qué es la llamada (hechos; el texto de las páginas no puede decir otra cosa)

- **Gratis, 15 minutos** (el número viene de la API, campo `minutes`; no lo escribas fijo).
- **Dayana llama por WhatsApp** a la hora elegida. No hay enlace de videollamada ni de Meet.
- La agenda sola la persona, en el calendario real de Dayana.
- Sin precios en ningún sitio del embudo. Sin promesas de resultados ni lenguaje médico.

## El recorrido

| Paso | Dónde | Qué pasa | Qué queda en el CRM |
|---|---|---|---|
| 0 | `/llamada` | Aterriza desde redes. Se guarda de dónde vino (`utm_*`, `fbclid`, `ttclid`, `gclid`, `?ref=`, referente). | — |
| 1 | `/llamada` | Nombre + WhatsApp + permiso de datos. **Se guarda al instante.** | Contacto (etiqueta `llamada-web`), su chat de WhatsApp, fila en «Embudo», aviso en la campana. |
| 2 | `/llamada` | Dos preguntas: qué quiere trabajar y para cuándo (+ nota y correo opcionales). | Respuestas en la fila y una nota en el contacto. |
| 3 | `/llamada` | Elige una hora (pocos días, pocas horas, en SU zona horaria). | La misma cita que agenda la asistente de WhatsApp: evento en Google Calendar, fila en Agenda, recordatorios. Aviso con sonido a Dayana. |
| 4 | `/llamada/<token>` | **Su página** («ya tienes tu llamada»): fecha y hora, confirmar por WhatsApp, añadir al calendario, cambiar o cancelar, qué va a pasar. | «Confirmó» cuando escribe por WhatsApp o toca el botón. |

Quien abandona en el paso 2 o 3 ya es un contacto: aparece en «Embudo» como
«Dejó sus datos» / «Respondió, sin hora» para que Dayana le haga seguimiento.

`<token>` es un secreto por envío del formulario. El navegador lo guarda
(`localStorage`, clave `dayana_llamada_token`) para que quien vuelva a `/llamada`
vaya directo a su página.

## Lógica (`lib/crm/call-funnel/`)

- `rules.ts` — puro, **importable desde el navegador** (sin Prisma ni Node):
  `TOPICS`, `URGENCIES`, `attributionFromUrl`, `hasAttribution`, `dayLabel`,
  `timeLabel`, `whenLabel`, `STAGE_LABEL`, tipos `Attribution`, `FunnelSlot`,
  `LeadStage`, `Channel`, `CHANNEL_LABEL`.
- `server.ts` — solo servidor: `startLead`, `saveAnswers`, `funnelSlots`,
  `bookCall`, `cancelCall`, `noteConfirmClick`, `getFunnelPage`,
  `getCallForIcs`, `listFunnelLeads`, `funnelStats`, `setLeadFollowUp`,
  tipos `FunnelPage`, `FunnelLeadRow`, `FunnelStats`, `FollowUp`.
- `config.ts` — `getCallFunnelConfig`, `setCallFunnelConfig`
  (`{ enabled, days, perDay, bookingsPerIpPerDay }`, SiteSetting `call.funnel`).
- `calendar.ts` — el calendario de la petición. **Fuera de producción es uno de
  mentira** (horario de Ajustes + lo agendado en la base, eventos `local-…`):
  las pruebas nunca tocan el calendario real de Dayana.

La cita se crea con `bookFreeCall` (`lib/crm/whatsapp-agent/free-call.ts`), la
misma función de la asistente de WhatsApp: mismo candado, mismo tope diario,
mismos recordatorios. No hay un segundo sistema de citas.

## API pública

Todas responden JSON. `429 { error: "rate_limited" }` en cualquiera.

### `POST /api/llamada` — paso 1
Cuerpo:
```json
{ "firstName": "Ana", "lastName": null, "phone": "3001234567", "phoneCountry": "CO",
  "consentData": true, "consentMarketing": false, "timezone": "America/Bogota",
  "attribution": { "utmSource": "instagram", "utmMedium": null, "utmCampaign": null, "utmContent": null,
                   "utmTerm": null, "fbclid": null, "ttclid": null, "gclid": null, "ref": null,
                   "referrer": null, "landingPath": "/llamada" },
  "hp": "" }
```
- `200 { "ok": true, "token": "…" }`
- `400 { "error": "name_required" | "phone_required" | "consent_required" | "invalid_phone" | "invalid" }`
- `hp` es la trampa para bots: un campo oculto que debe ir vacío.

### `POST /api/llamada/<token>/respuestas` — paso 2
Cuerpo: `{ "topic": "<id de TOPICS>", "urgency": "<id de URGENCIES>", "note": "…" | null, "email": "…" | null }`
- `200 { "ok": true }` · `400 { "error": "invalid" }` · `404 { "error": "not_found" }`

### `GET /api/llamada/horas` — las horas de ahora (iguales para todos)
- `200 { "state": "ok", "slots": [{ "startIso": "…", "endIso": "…" }], "minutes": 15, "dayanaTz": "America/Bogota" }`
- `200 { "state": "unavailable", "reason": "closed" | "calendar" | "empty" }` → mostrar «escríbenos por WhatsApp».

Las horas vienen en UTC (ISO). **La página las agrupa y las muestra en la zona
del navegador** (`dayLabel` / `timeLabel` de `rules.ts`) y dice cuál zona es.

### `POST /api/llamada/<token>/agendar` — paso 3 (y cambiar de hora)
Cuerpo: `{ "startIso": "…" }` (una de las de `/horas`). Si ese enlace ya tiene
su llamada por delante, la **mueve** (nunca quedan dos).
- `200 { "status": "booked", "startIso": "…", "endIso": "…", "moved": false }`
- `409 { "status": "unavailable", "slots": [...] }` → esa hora se ocupó; mostrar las nuevas.
- `409 { "status": "already_booked" }` → ese número ya tiene una llamada (no se dice cuándo).
- `503 { "status": "closed" }` → no se puede por la página ahora; WhatsApp.
- `404 { "status": "not_found" }`

### `POST /api/llamada/<token>/cancelar`
- `200 { "status": "cancelled" | "nothing" }` · `503 { "status": "closed" }` · `404 { "status": "not_found" }`

### `POST /api/llamada/<token>/confirmar`
Aviso de que tocó «Confirmar por WhatsApp» (`navigator.sendBeacon`). `204`.

### `GET /api/llamada/<token>/calendario`
El `.ics` de la cita (Apple Calendar, Outlook). `404` si no tiene una por delante.

## Su página: `getFunnelPage(token)`

```ts
type FunnelPage = {
  firstName: string;
  stage: "datos" | "preguntas" | "agendada" | "hablaron" | "no_contesto" | "pasada" | "cancelada";
  answered: boolean;                    // ya respondió el paso 2
  call: { startIso; endIso; minutes } | null;
  canChange: boolean;                   // puede cambiar o cancelar
  confirmed: boolean;                   // ya escribió por WhatsApp o tocó «Confirmar»
  personTz: string | null;              // zona guardada al registrarse
  dayanaTz: string;
  confirmUrl: string | null;            // wa.me con el mensaje de confirmación
  helpUrl: string;                      // wa.me para pedir ayuda
  googleCalendarUrl: string | null;
  icsPath: string | null;               // `/api/llamada/<token>/calendario`
};
```
`null` → el enlace no existe (404).

Qué muestra según `stage`:
- `datos` / `preguntas` / `cancelada` → «Te falta elegir tu hora» + el selector de horas.
- `agendada` → la cita, confirmar por WhatsApp, calendario, cambiar/cancelar, qué va a pasar.
- `hablaron` / `no_contesto` / `pasada` → la llamada ya pasó; siguiente paso por WhatsApp.

## Medición

Con permiso de cookies de marketing (ya lo controla `MetaPixel`):
- Paso 1 guardado → Pixel `Lead` + dataLayer `call_funnel_lead`.
- Paso 2 → dataLayer `call_funnel_answers`.
- Cita agendada → Pixel `Schedule` + dataLayer `call_funnel_booked`.

## Reglas de texto (todas las páginas)

- Español, de tú. **Género neutro**: nunca «lista», «bienvenida», «sola»; se reformula («¿Te sirve?», «cuando quieras»).
- Sin emojis como interfaz, sin corazones, sin diminutivos cariñosos.
- Sin precios. Sin testimonios ni cifras inventadas: los testimonios salen de `lib/content/testimonios`.
- `DESIGN.md` manda en lo visual. Páginas públicas siempre en modo claro.
