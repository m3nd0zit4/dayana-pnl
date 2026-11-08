# Voz del asistente

El asistente del panel (`docs/agentes.md`) habla y escucha. Tres piezas, cada
una usable sola, todas apagadas o inofensivas por defecto.

| Pieza | Dónde | Cuesta | Por defecto |
|---|---|---|---|
| **Modo voz** en el panel | botón ondas (escritorio) / botón ondas de la pastilla (teléfono) | gratis (voz del navegador) | disponible |
| **Notas de voz** a su WhatsApp | `send_owner_voice_note`, Ajustes → Canales del agente | Gemini TTS, < 0,005 USD por nota de 20 s | apagado |
| **Llamadas** a su celular | `call_owner`, mismo ajuste | según proveedor (abajo) | apagado |

## 1. Modo voz en el panel

- Dayana toca el botón de ondas (junto al micrófono en el panel; en el
  teléfono es el botón de la pastilla de abajo cuando la caja está vacía).
- Habla; tras **1,6 s de silencio** lo dicho se manda solo (o «Enviar ya»).
- La respuesta se lee en voz alta (`speechSynthesis` del navegador, voz
  `es-CO` si existe, si no la latinoamericana más cercana) y el micrófono se
  vuelve a abrir. Nunca escucha mientras habla.
- Markdown, enlaces, tablas y emojis no se leen (`lib/voice/speech-text.ts`);
  una respuesta larga se corta en una frase: «El resto te lo dejé en pantalla».
- **Aprobaciones**: la tarjeta se lee («Necesito tu aprobación para: Crear
  contacto. Nombre… ¿Lo hago? Di sí o no, o toca Aprobar»). Un «sí» corto y
  claro abre una **cuenta atrás de 4 s en pantalla** con «Cancelar» / «Aprobar
  ya»; «no» la rechaza; cualquier otra cosa («sí, pero cámbiale la hora») no
  aprueba y vuelve a preguntar. Es la misma regla de una sola aprobación: lo
  hablado nunca aprueba sin que la pantalla lo muestre.
- Mismo agente, mismos hilos sincronizados: lo dicho queda escrito en la
  conversación como si se hubiera tecleado.
- Funciona en Chrome/Edge (escritorio y Android) y Safari (Mac, iPhone). En
  Firefox no hay reconocimiento de voz: el botón no aparece.
- Código: `lib/agent-ui/voice-mode.ts` (máquina de estados, pura, con
  tests), `agent-panel/use-speech-synthesis.ts`, `agent-panel/VoiceModeBar.tsx`,
  la integración en `AgentPanel.tsx`.

### Gemini Live (evaluado, no construido)

Gemini Live (`gemini-3.8-live`, disponible en la clave) daría conversación de
verdad en tiempo real (interrumpir a mitad de frase, ~0,3 s de latencia) por
~0,02–0,03 USD/min. No se construyó todavía porque **no es el mismo agente**:
Live es otro modelo con su propia sesión y sus propias herramientas; para usar
las del CRM habría que reimplementar el equipo de agentes, las aprobaciones y
los hilos sincronizados sobre su sesión WebSocket (token efímero emitido por el
servidor). El modo voz actual cuesta 0 y reutiliza todo. Si Dayana quiere voz
más natural o interrumpir, el paso intermedio barato es leer las respuestas con
Gemini TTS (las mismas voces que las notas) en vez de la voz del navegador.

## 2. Notas de voz a Dayana

- `send_owner_voice_note` (todos los agentes; sin tarjeta de aprobación, como
  `message_owner`: va a ella misma, el número no lo elige el modelo) y, si lo
  enciende, **sus avisos por iniciativa propia** (`message_owner`, el resumen
  de la mañana) también le llegan leídos (`lib/crm/agent-messages.ts`).
- Texto → **Gemini TTS** (`gemini-3.8-flash-tts`, voz «Kore»; `GEMINI_TTS_MODEL`
  / `GEMINI_TTS_VOICE` para cambiarlo) → PCM 24 kHz → **Ogg/Opus** con
  `opusscript` (libopus en JS, sin binarios) y el mismo muxer Ogg que ya usaban
  las notas grabadas en el CRM → `audio` con `voice: true` por 360dialog.
- **Por qué Gemini TTS y no Kokoro/Piper**: esos modelos son gratis pero hay que
  alojarlos (Piper es un binario nativo; Kokoro son ~90 MB de ONNX más su
  runtime): en una función de Vercel son arranques en frío de varios segundos o
  pasarse del tamaño. Gemini TTS es una llamada con la clave que el CRM ya paga
  (prepago = nivel de pago: no entrena con los datos), habla bien español y una
  nota de 20 s cuesta menos de medio centavo. Probado el 8-nov: 6,8 s de audio
  en ~4,7 s, transcrito de vuelta palabra por palabra.
- Gemini TTS **lee en voz alta cualquier instrucción** que vaya delante del texto
  y rechaza la instrucción de sistema (400): solo se le manda el texto.
- Solo al número guardado en Ajustes; si ese número ya es un chat de trabajo
  (clienta, interesada…) no se acepta. Su chat queda «equipo» y en Manual: la IA
  de WhatsApp no le contesta.
- Límites: 6 por hora, 20 por día; las de iniciativa propia solo de 8:00 a 21:00
  (Bogotá, configurable).
- **Ventana de 24 h**: WhatsApp solo deja mandar un audio si ella le escribió a
  la empresa desde ese número en las últimas 24 h (no hay plantillas de audio).
  Fuera de la ventana se dice en una línea y el aviso queda en la campana.
- El chat del CRM guarda la transcripción de la nota; el audio no se puede
  reproducir desde el CRM (Blob suspendido desde sep-2026).

## 3. Llamadas a Dayana

Su número de WhatsApp es coexistencia: **no puede hacer llamadas de WhatsApp**.
`call_owner` (con tarjeta de aprobación) llama a su celular por el proveedor
elegido en Ajustes; **apagado por defecto**. Lo que ella responda al teléfono
**no aprueba nada**: llega al panel como mensaje del asistente («Te llamé por
esto… Me respondiste…») y cualquier acción sigue pidiendo su toque.

| Proveedor | Qué hace | Estado |
|---|---|---|
| `off` | nada | por defecto |
| `fake` | registra la llamada, no suena nada | para probar el flujo |
| `twilio` (B) | llamada telefónica: dice el mensaje (`<Say>`), escucha (`<Gather input="speech" language="es-CO">`), webhook `/api/webhooks/twilio/agent-call` firmado | listo, falta número con voz |
| `whatsapp` (A) | API de llamadas de WhatsApp desde un 2.º número solo-Cloud-API | petición a Meta lista; falta número + puente de medios |

Límites: 2 por hora, 6 por día; las de iniciativa propia dentro de su horario.
Código: `lib/voice/calls/` (`providers.ts`, `twiml.ts`, `owner-call.ts`), tests
en `providers.test.ts`, e2e `scripts/agent-voice-e2e.ts` (dev, sin enviar).

### Recomendación: B (Twilio)

- La cuenta de Twilio **ya existe** (SMS): mismas credenciales, misma firma de
  webhooks. Solo falta un número con voz.
- Funciona en Vercel tal cual (cada turno es un TwiML; sin WebSocket).
- Llama a cualquier teléfono; no necesita el permiso de llamada de Meta ni el
  límite de 2 000 mensajes ni un segundo número de WhatsApp.
- A necesita además un servidor siempre encendido (LiveKit/WebRTC) que Vercel
  no puede ser, más ~49 EUR/mes del segundo número en 360dialog.

### Lo que hace falta (lo pone la dueña; nada de esto se compró ni se creó)

**Para B (recomendado):**
1. Un número de Twilio con voz. Lo más barato: un número de EE. UU. (~1,15
   USD/mes, sin documentos) que ella guarda en su celular como «Asistente». Un
   número colombiano (~14 USD/mes) pide cédula y dirección local.
2. En Twilio: permisos geográficos de voz para Colombia (Voice → Geo
   permissions).
3. En Vercel (producción), pegados por ella: `TWILIO_VOICE_FROM_NUMBER` (el
   número nuevo). `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` ya están.
4. Costo aproximado (verificar en la página de precios de Twilio): llamada
   saliente a celular de Colombia ~0,04 USD/min + reconocimiento de voz del
   `<Gather>` ~0,02 USD por respuesta. Una llamada de 1 min ≈ 0,06 USD.
5. Ajustes → Canales del agente → Llamadas: «Llamada normal (Twilio)» → «Probar
   llamada».

**Para A:** un segundo número solo-Cloud-API (360dialog ~49 EUR/mes, o Meta
directo), la API de llamadas habilitada, el permiso de llamada de Dayana, un
puente de medios WebRTC (LiveKit Cloud: 1 000 min gratis, luego ~0,01 USD/min)
con un agente de voz (Gemini Live ~0,02–0,03 USD/min), y
`WHATSAPP_CALLING_PHONE_NUMBER_ID`, `WHATSAPP_CALLING_TOKEN`,
`AGENT_CALL_MEDIA_BRIDGE_URL`.

## Ajustes

`site_settings` «agent.voice» (JSON): número personal, notas on/off, avisos como
nota on/off, proveedor de llamadas, horario. Pantalla: Ajustes → Canales del
agente → «Voz del asistente» (solo OWNER, `/api/admin/settings/agent-voice`).
Sin migración.

## Pruebas

```bash
bun test lib/voice lib/agent-ui/voice-mode.test.ts
bun --env-file=../dayana-pnl/.env scripts/agent-voice-e2e.ts      # neondb_dev, sin enviar nada
# capturas del modo voz (micrófono y voz simulados), con next dev en :3100:
bun --env-file=../dayana-pnl/.env scripts/dev/staff-session-cookie.ts .eve/owner-storage.json http://localhost:3100
node node_modules/tsx/dist/cli.mjs scripts/dev/voice-mode-shots.ts .eve/owner-storage.json .eve/screenshots/voz
```

`next dev` local para el panel: quitar `VERCEL` del entorno (con esa variable
`withEve` no levanta `eve dev` y `/eve/v1/*` da 404).
