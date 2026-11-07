# Servidor MCP del CRM

`/api/mcp` expone las herramientas del CRM a cualquier cliente MCP: Claude Code,
Claude Desktop, Cursor o el agente de otra persona. Son **las mismas
herramientas que usan los agentes del panel** (`agent/lib/registry.ts`), con los
mismos guardas de rol (`agent/lib/guard.ts`), filtradas por los permisos del
token.

- **Transporte:** Streamable HTTP, sin estado (sin sesiones ni Redis). Lo sirve
  `mcp-handler` 2.3.0 sobre `@modelcontextprotocol/server` 2.4.0; responde a
  clientes de la especificación 2026-07-28 y a los de 2025.
- **Código:** `app/api/mcp/route.ts` (ruta), `lib/mcp/tokens.ts` (tokens),
  `lib/mcp/scopes.ts` (permisos, puro), `lib/mcp/server.ts` (registro de
  herramientas, ejecución, auditoría).
- **Autenticación:** `Authorization: Bearer dpnl_…`. Sin token, o con uno
  inválido, revocado o caducado: **401**. La ruta está fuera del `matcher` de
  `proxy.ts`: aquí no hay cookie, la puerta es el token.

## Permisos

Cada herramienta tiene un nivel en `TOOL_CATALOG[name].access`, y ese es el
scope que hace falta para verla y llamarla. `tools/list` **solo enseña** lo que
el token puede usar; lo demás ni aparece.

| Scope | Qué permite | OWNER | OPERATOR | READONLY | DEVELOPER |
|---|---|:-:|:-:|:-:|:-:|
| `read` | Consultar: contactos, pagos, chats, talleres, eventos, citas, estadísticas | ✓ | ✓ | ✓ | — |
| `edit` | Cambiar datos que solo ve el equipo: contactos, borradores, talleres, la memoria del agente | ✓ | ✓ | — | — |
| `execute` | Lo que sale del CRM o mueve dinero: WhatsApp, correo, SMS, envíos masivos, pagos manuales, precios, cuentas del equipo | ✓ | — | — | — |

- Los scopes se eligen al crear el token y **nunca superan el rol**.
- En **cada petición** se recalculan: `scopes del token ∩ scopes del rol de
  hoy`. Si alguien baja de rol, pierde lo que ya no le toca al instante; si se
  desactiva su cuenta, todos sus tokens dejan de valer.
- Las herramientas siguen comprobando el rol por su cuenta (p. ej. los envíos
  masivos son solo del OWNER), así que el scope es un mínimo, no un pase.

## Crear un token

CRM → **Ajustes → Conexiones MCP** (`/admin/ajustes/mcp`) → «Nueva conexión»:
nombre, permisos (los que tu rol no permite salen deshabilitados) y caducidad
(30 / 90 / 365 días o sin caducidad).

El token se muestra **una sola vez**, con los fragmentos listos para pegar. En la
base solo queda su sha256 y los 12 primeros caracteres para reconocerlo. Cada
persona ve y revoca las suyas; el OWNER ve y revoca las de todo el equipo.

API (sesión de staff): `GET /api/admin/mcp-tokens`, `POST /api/admin/mcp-tokens`
`{ name, scopes, expiresInDays: 30 | 90 | 365 | null }` → `{ token, record }`,
`DELETE /api/admin/mcp-tokens/<id>` (revocar).

## Conectar un cliente

URL de producción: `https://www.dayanabeltran.com/api/mcp` (siempre con `www`:
el ápice responde 308 y muchos clientes no siguen la redirección con el POST).

**Claude Code**

```bash
claude mcp add --transport http dayana-crm https://www.dayanabeltran.com/api/mcp \
  --header "Authorization: Bearer dpnl_…"
```

**Claude Desktop** (`claude_desktop_config.json`; necesita Node.js — Desktop
solo habla stdio con servidores locales, `mcp-remote` hace de puente):

```json
{
  "mcpServers": {
    "dayana-crm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://www.dayanabeltran.com/api/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer dpnl_…" }
    }
  }
}
```

El token va en `env` y sin espacio en `--header` porque en Windows `npx` parte
los argumentos con espacios.

**Cursor y otros** (Streamable HTTP con cabeceras):

```json
{
  "mcpServers": {
    "dayana-crm": {
      "url": "https://www.dayanabeltran.com/api/mcp",
      "headers": { "Authorization": "Bearer dpnl_…" }
    }
  }
}
```

**Genérico:** `POST /api/mcp` con `Content-Type: application/json`,
`Accept: application/json, text/event-stream` y el `Authorization` de arriba.

## Seguridad

- **Auditoría.** Toda llamada de `edit` o `execute` deja una fila
  `MCP_TOOL_CALL` (herramienta, entrada saneada, si fue bien, id y nombre del
  token) aunque la herramienta se olvide de auditar. Las escrituras de las
  propias herramientas salen como `MCP_*` en vez de `AGENT_*`, con
  `mcpTokenId`. Crear y revocar tokens: `MCP_TOKEN_CREATED` /
  `MCP_TOKEN_REVOKED`. Nunca se guarda el token ni un código de verificación
  (cualquier clave con `code`, `otp`, `token`, `password`… sale como
  `[oculto]`).
- **Pagos manuales con código.** `record_manual_payment` exige el código que
  `request_payment_otp` manda al correo de Dayana. Un token robado no basta para
  registrar un pago: hace falta su bandeja de entrada.
- **Revocar** corta al instante (la verificación lee la base en cada petición).
- **Límite:** 120 peticiones por minuto y token (Upstash si está configurado,
  si no en memoria). Pasado, 429 con `Retry-After: 60`.
- **Errores** vuelven como `isError: true` con el mensaje, nunca con stack.
- **Producción vs desarrollo.** Un token vale solo en la base donde se creó: los
  de producción no sirven contra `neondb_dev` ni al revés. Las pruebas van
  siempre contra `neondb_dev`. Ojo: la base de dev tiene una clave real de
  WhatsApp, así que las herramientas de envío mandan mensajes de verdad también
  desde ahí.
- `lastUsedAt` se actualiza como mucho una vez por minuto.

## Probar en local (stdio contra `neondb_dev`)

`scripts/mcp/crm-stdio.ts` sirve las mismas herramientas por stdio, sin token,
como la persona del equipo de `CRM_MCP_STAFF_EMAIL` (activa) con los scopes de su
rol. **No arranca si `DATABASE_URL` no es `/neondb_dev`**, y no hay forma de
saltárselo.

```bash
claude mcp add dayana-crm-dev -e CRM_MCP_STAFF_EMAIL=tu@correo -- \
  bun --env-file=../dayana-pnl/.env scripts/mcp/crm-stdio.ts
```

Pruebas:

- `bun test ./lib/mcp` — scopes, forma de los tokens, saneado de la auditoría.
- `bun --env-file=../dayana-pnl/.env scripts/mcp/mcp-e2e.ts` — llama a la ruta
  dentro del proceso: 401 sin token / inventado / revocado / caducado,
  `initialize`, `tools/list` por scope, una lectura de cada herramienta nueva,
  la fila `MCP_TOOL_CALL` de una edición, y que un token de solo lectura no ve
  ni puede llamar edición. Borra sus tokens al terminar. No llama a ninguna
  herramienta de envío.

## Fase 2: OAuth para los conectores de claude.ai

claude.ai (web) solo conecta servidores remotos con OAuth 2.1, no con una
cabecera fija. No está construido. La capa de autenticación ya está preparada:
la ruta usa `withMcpAuth` de `mcp-handler`, que responde los 401 con el
`WWW-Authenticate` de RFC 9728. Faltaría:

1. Un servidor de autorización (o uno externo) con PKCE y, para la
   especificación 2026-07-28, Client ID Metadata Documents.
2. Servir `/.well-known/oauth-protected-resource` con `protectedResourceHandler`
   de `mcp-handler`.
3. Que `verifyToken` acepte también los access tokens de OAuth y los convierta en
   el mismo `McpCaller` (persona, rol, scopes ∩ rol). El resto —registro de
   herramientas, auditoría, límite— no cambia.
