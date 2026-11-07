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
