# Agentes del panel

El asistente del panel (`/admin`, botón del asistente) ya no es un solo agente
con 50 herramientas: es un **equipo**.

| Agente | Qué hace |
|---|---|
| **Asistente** (`auto`) | Responde lo rápido (estadísticas, pendientes, buscar a alguien, pagos) y reparte el resto. |
| **Ventas** | Estadísticas, pagos (también el pago manual con código), inscripciones, precios, códigos. |
| **WhatsApp** | Chats, la IA de WhatsApp: por qué respondió algo, corregirla (guiones/configuración), envíos. |
| **Agenda** | Calendario, citas, días bloqueados, horario de la IA, zonas horarias. |
| **Talleres y eventos** | Talleres, eventos gratuitos, inscritas e interesadas. |
| **Contactos y equipo** | Contactos, correos, SMS, Google, usuarios del equipo. |

En el panel se elige con quién hablar (menú arriba). Cada conversación queda con
su agente. «Asistente» delega en el especialista cuando hace falta; la
aprobación de lo que el especialista quiera hacer llega igual al panel, una vez.

## Voz

El panel tiene «Modo voz» (habla y escucha con la voz del navegador, gratis) y
el asistente puede mandarle notas de voz a Dayana por WhatsApp y llamarla
(apagado por defecto). Ver `docs/voz-del-asistente.md`.

## Cómo está hecho

- `agent/lib/catalog.ts` — la única lista: cada herramienta con su nivel
  (`read` / `edit` / `execute`), a qué agentes pertenece y su nombre en
  español. La usan los agentes, el servidor MCP (`docs/mcp.md`) y el panel.
- `agent/lib/tools/*.ts` — las herramientas (fuera de `agent/tools/` a propósito,
  para que eve no se las dé todas a todos).
- `agent/tools/crm.ts` y `agent/subagents/<id>/tools/crm.ts` — entregan a cada
  agente solo sus herramientas (`defineDynamic`).
- `agent/lib/prompts.ts` — reglas comunes + el papel de cada agente.
  `agent/instructions/role.ts` elige el papel según el agente del hilo
  (cabecera `x-crm-agent`).
- `agent/channels/eve.ts` — quién entra: el OWNER con su sesión; para las
  pruebas, un token que solo existe contra `neondb_dev`.
- Las herramientas de shell/archivos/web de eve están apagadas
  (`agent/tools/bash.ts`, etc.).

### Aprobaciones: una sola vez

Toda herramienta `edit`/`execute` (salvo `memory`) lleva `approval` y el panel
muestra **una** tarjeta. El prompt prohíbe preguntar «¿confirmas?» antes. Lo
comprueban `lib/agent-eval/catalog.test.ts` (ninguna escritura sin aprobación) y
el eval (`doubleApproval`).

**Aprobaciones que pide un especialista** (8-nov: «escríbele a … para
proponerle otra hora» se quedaba en «Ejecutando…»). eve reenvía la petición del
hijo con el `turnId`/`stepIndex` del hijo (`turn_0`), y su reductor la colgaba
del primer mensaje: el panel nunca mostraba la tarjeta. `withProxiedInputs`
(`lib/agent-ui/proxied-input.ts`) la reubica junto a la llamada al especialista,
en el vivo y en el historial. La tarjeta pide el nombre real de la persona a
`GET /api/admin/agent/names` cuando el hilo no lo conoce (lo buscó el hijo).

**Salida de las herramientas en JSON puro**: los resolvedores (`agent/tools/crm.ts`
y `agent/subagents/*/tools/crm.ts`) pasan todo por `plainJson`; un `Date`
hacía fallar la llamada entera (`get_conversation` falló en todo chat con la
ventana abierta hasta el 8-nov). También conservan el `toModelOutput` de cada
herramienta, que antes se perdía.

### Personas reales: Dayana ↔ asistente ↔ IA de WhatsApp

- **La IA de WhatsApp no sabe qué responder** → escala: el chat queda en
  «Te toca» y Dayana recibe el aviso. En el chat, «Pregúntale al asistente»
  (`chatHelpOpener`, `lib/agent-ui/chat-help.ts`) abre el especialista de
  WhatsApp con lo que la persona escribió y por qué la IA lo dejó.
- **Dayana dice qué contestar**, con sus palabras → el especialista lo redacta
  con la voz de la asistente, conserva sus datos (día, hora, precio) y lo envía
  con `send_whatsapp_to_contact` (también a un chat sin contacto, con
  `conversationId`): una tarjeta de aprobación. Después pregunta una vez si la
  IA debe responder así la próxima vez: para esa persona (`whatsapp_set_chat`
  `instructions`) o para todos (`whatsapp_save_playbook`).
- **Para otra persona en el futuro**: «cuando Laura escriba, dile…» → instrucción
  del chat; la IA de WhatsApp la lee en cada respuesta de ese chat.
- **El asistente necesita a Dayana** (corre para un agente externo, o una tarea
  acaba en una pregunta suya) → `message_owner`: notificación que abre el panel
  en un hilo nuevo con esa pregunta.

### Memoria

`memory` guarda reglas que el equipo enseña («de ahora en adelante…») en
`agent_memories`, con tope por agente, y se inyectan al empezar cada
conversación. Las correcciones de cómo responde la IA de WhatsApp no van ahí:
van a sus guiones/configuración, que es lo que esa IA lee.

### Días de descanso

Un evento «ocupado» en el calendario de citas basta: la IA de WhatsApp nunca
ofrece horas que lo pisen. Para reglas fijas («nunca los viernes») el agente
cambia el horario de la IA y lo guarda en memoria.

## Evals

```bash
bun --env-file=../dayana-pnl/.env scripts/agent/eval-fixtures.ts   # datos de prueba
bun --env-file=../dayana-pnl/.env scripts/agent/eval-server.ts     # otra terminal
bun --env-file=../dayana-pnl/.env scripts/agent/eval.ts [ids…] [--k 2]
bun --env-file=../dayana-pnl/.env scripts/agent/eval-fixtures.ts --clean
```

Casos en `lib/agent-eval/cases.ts` (estadísticas, búsquedas, acciones con
aprobación, memoria, delegación). Cada caso corre k veces; pasa si todas las
corridas pasan los graders de código y el juez. Los envíos, pagos y precios se
**cancelan** siempre en el eval: la base de dev tiene la clave real de WhatsApp
y el código de pago va al correo real de la dueña.

Después de cambiar `lib/` hay que reiniciar `eval-server` (eve dev no recarga
todo).
