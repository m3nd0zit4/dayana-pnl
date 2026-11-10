# Servidor MCP del CRM

`/api/mcp` expone las herramientas del CRM a cualquier cliente MCP: Claude Code,
Claude Desktop, Cursor, Codex o el agente de otra persona. **Es la única puerta
de una IA al CRM**: el asistente que vivía dentro del panel (eve) se quitó en
noviembre de 2026. Dentro del CRM solo queda la IA que contesta WhatsApp
(`lib/crm/whatsapp-agent/`), que no usa estas herramientas.

Las herramientas están en `lib/crm-tools/` (`registry.ts` las lista,
`catalog.ts` dice el nivel de cada una), con los guardas de rol de
`lib/crm-tools/guard.ts`, filtradas por los permisos del token. Para usarlas
desde una terminal o un script sin cliente MCP está la [CLI](#cli-bun-run-crm).

- **Transporte:** Streamable HTTP, sin estado (sin sesiones ni Redis). Lo sirve
  `mcp-handler` 2.3.0 sobre `@modelcontextprotocol/server` 2.4.0; responde a
  clientes de la especificación 2026-07-28 y a los de 2025.
- **Código:** `app/api/mcp/route.ts` (ruta), `lib/mcp/tokens.ts` (tokens),
  `lib/mcp/scopes.ts` (permisos, puro), `lib/mcp/server.ts` (registro de
  herramientas, ejecución, auditoría), `lib/mcp/oauth*.ts` (OAuth),
  `lib/crm-tools/` (las herramientas: `catalog.ts`, `registry.ts`, `tools/*.ts`,
  `define-tool.ts`), `scripts/crm-cli.ts` (la CLI).
- **Autenticación:** `Authorization: Bearer dpnl_…` (token personal) o
  `Bearer dpat_…` (access token de OAuth, ver [Conectar con OAuth](#conectar-con-oauth-claudeai-y-otros)).
  Sin token, o con uno inválido, revocado o caducado: **401** con
  `WWW-Authenticate: Bearer … resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"`.
  La ruta está fuera del `matcher` de `proxy.ts`: aquí no hay cookie, la puerta
  es el token.

## Permisos

Cada herramienta tiene un nivel en `TOOL_CATALOG[name].access`, y ese es el
scope que hace falta para verla y llamarla. `tools/list` **solo enseña** lo que
el token puede usar; lo demás ni aparece.

| Scope | Qué permite | OWNER | OPERATOR | READONLY | DEVELOPER |
|---|---|:-:|:-:|:-:|:-:|
| `read` | Consultar: contactos, pagos, chats, talleres, eventos, citas, estadísticas | ✓ | ✓ | ✓ | — |
| `edit` | Cambiar datos que solo ve el equipo: contactos, borradores, talleres | ✓ | ✓ | — | — |
| `execute` | Lo que sale del CRM o mueve dinero: WhatsApp, correo, SMS, envíos masivos, pagos manuales, precios, cuentas del equipo | ✓ | — | — | — |

- Los scopes se eligen al crear el token y **nunca superan el rol**.
- En **cada petición** se recalculan: `scopes del token ∩ scopes del rol de
  hoy`. Si alguien baja de rol, pierde lo que ya no le toca al instante; si se
  desactiva su cuenta, todos sus tokens dejan de valer.
- Las herramientas siguen comprobando el rol por su cuenta (p. ej. los envíos
  masivos son solo del OWNER), así que el scope es un mínimo, no un pase.
- No hay tarjeta de aprobación: el scope es la aprobación. Las herramientas
  `edit`/`execute` llevan `approval: always()` (`lib/crm-tools/define-tool.ts`)
  solo como marca, y el servidor la traduce en `readOnlyHint` /
  `destructiveHint` para que el cliente pida confirmación si quiere (Claude
  Code lo hace). `lib/crm-tools/catalog.test.ts` comprueba que toda escritura
  la lleve.
- `memory` y `message_owner` ya no existen: eran del asistente del panel.

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

## CLI (`bun run crm`)

`scripts/crm-cli.ts` habla con `/api/mcp` por HTTP, como cualquier cliente MCP
(JSON-RPC sobre Streamable HTTP, entiende respuestas JSON y SSE). No toca la
base ni importa el servidor: puede exactamente lo que el token puede por MCP, y
todo lo que cambia queda auditado con el nombre de la conexión.

```bash
export CRM_MCP_TOKEN=dpnl_…        # Ajustes → Conexiones MCP (o un dpat_… de OAuth)
export CRM_MCP_URL=https://www.dayanabeltran.com/api/mcp   # el valor por defecto

bun run --silent crm tools                 # lo que tu token puede usar, con su nivel
bun run --silent crm tools --json          # lo mismo en JSON: [{name, access, title}]
bun run --silent crm describe crm_stats    # descripción + JSON Schema de entrada
bun run --silent crm call crm_stats '{"area":"ventas"}'
echo '{"q":"María"}' | bun run --silent crm call search_contacts -   # argumentos por stdin
bun run --silent crm call get_contact @args.json                     # o desde un archivo
bun run --silent crm info                  # servidor, versión e instrucciones
```

- **Token solo por variable de entorno**, nunca como argumento (quedaría en el
  historial). Sin `CRM_MCP_URL` va contra producción; para desarrollo,
  `http://localhost:3100/api/mcp` con un token creado en el CRM local (los
  tokens solo valen en la base donde se crearon). La URL tiene que ser https o
  localhost.
- **Salida:** el resultado va a stdout en JSON (el `structuredContent` de la
  herramienta; si no lo hay, su texto). Los errores van a stderr como
  `{"error": "…", …}`. `--silent` quita la línea `$ bun scripts/crm-cli.ts …`
  que `bun run` imprime antes.
- **Códigos de salida:** `0` bien · `1` la herramienta falló (p. ej. «Ese
  contacto no existe.») · `2` uso incorrecto, JSON inválido, entrada que no
  cumple el esquema, herramienta inexistente (con `didYouMean`) o sin permiso
  (con `needs`: el scope que falta) · `3` conexión, `401` (token inventado,
  revocado, caducado o de otra base), `429` (120 peticiones por minuto y
  token) o una redirección (el ápice sin `www`) · `4` resultado desconocido:
  una llamada a herramienta que se cortó o recibió un 5xx (p. ej. el 504 de
  Vercel a los 60 s) pudo haberse ejecutado — un envío masivo pudo salir —, así
  que no se repite sin comprobar antes en el CRM.
- **PowerShell 5.1** quita las comillas de dentro de un argumento: ahí pasa el
  JSON por stdin (`'{"area":"ventas"}' | bun scripts/crm-cli.ts call crm_stats -`)
  o con `@archivo.json`. El BOM que PowerShell antepone se ignora.
- El nivel que enseña `tools` sale de las anotaciones del servidor
  (`readOnlyHint` → `read`, `destructiveHint` → `execute`, si no `edit`), igual
  que `TOOL_CATALOG[name].access`.

## Cómo la usa una IA externa (Claude Code, Codex, Cursor…)

Dos caminos, con el mismo token y los mismos permisos:

1. **MCP (lo normal).** Si el cliente habla MCP, se conecta a
   `https://www.dayanabeltran.com/api/mcp` como en
   [Conectar un cliente](#conectar-un-cliente) (cabecera con el token) o con
   OAuth (solo la URL). Ve las herramientas con sus esquemas, sus títulos en
   español y las anotaciones `readOnlyHint` / `destructiveHint`; el servidor le
   manda además unas instrucciones (`MCP_INSTRUCTIONS` en `lib/mcp/server.ts`:
   monedas, cómo buscar a una persona, el pago manual con código).
2. **CLI (sin cliente MCP, o desde un script).** Un agente con terminal (Codex,
   Claude Code en otro repo, un cron) exporta `CRM_MCP_TOKEN` y llama a
   `bun run --silent crm …` desde este repositorio. El flujo que funciona:
   `crm tools --json` para saber qué hay → `crm describe <herramienta>` para el
   esquema → `crm call <herramienta> '<json>'` y leer el JSON de stdout; si el
   código de salida no es 0, leer el `error` de stderr y no reintentar a ciegas.

Reglas para cualquier IA que entre:

- Las herramientas `execute` (WhatsApp, correo, SMS, envíos masivos, precios,
  pagos, cuentas del equipo) llegan a personas reales. **Confirma con la persona
  que te pidió la tarea antes de llamarlas**: el servidor no pregunta por ti.
- Dale a cada IA su propia conexión, con el mínimo scope que necesite
  (`read` para consultar): así cada una se revoca por separado en Ajustes →
  Conexiones MCP y la auditoría dice cuál hizo qué.
- Contra desarrollo (`neondb_dev`) las herramientas de envío **también mandan
  de verdad** (la base de dev tiene una clave real de WhatsApp): para pruebas,
  solo lecturas o herramientas `edit` con ids inventados.
- El pago manual exige el código que llega al correo de Dayana
  (`request_payment_otp` → `record_manual_payment`): nunca lo inventes.

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

- `bun test ./lib/mcp` — scopes, forma de los tokens, saneado de la auditoría,
  y lo puro del OAuth (PKCE, `redirect_uri`, registro, CIMD, metadatos).
- `bun --env-file=../dayana-pnl/.env scripts/mcp/mcp-e2e.ts` — llama a la ruta
  dentro del proceso: 401 sin token / inventado / revocado / caducado,
  `initialize`, `tools/list` por scope, una lectura de cada herramienta nueva,
  la fila `MCP_TOOL_CALL` de una edición, que un token de solo lectura no ve
  ni puede llamar edición, y que `memory` / `message_owner` ya no existen.
  Borra sus tokens al terminar. No llama a ninguna herramienta de envío.
- `bun test ./lib/crm-tools` — el catálogo (toda escritura marcada, ninguna
  lectura marcada, cada herramienta con descripción y esquema).
- `bun --env-file=../dayana-pnl/.env scripts/mcp/mcp-oauth-e2e.ts` — el OAuth
  entero como claude.ai (ver abajo), dentro del proceso. Con
  `--base=http://localhost:3100` va por HTTP contra un `next dev` local y pasa
  por la pantalla de consentimiento real con una sesión del OWNER de dev.

## Conectar con OAuth (claude.ai y otros)

claude.ai (web, escritorio y móvil) solo conecta servidores remotos con OAuth
2.1, no con una cabecera fija. El CRM es su propio servidor de autorización:
quien conecta inicia sesión con **su cuenta del CRM** y elige los permisos.

**claude.ai:** Ajustes → Conectores → «Añadir conector personalizado» → URL
`https://www.dayanabeltran.com/api/mcp` (con `www`), sin client id ni secreto.
Al pulsar «Conectar» se abre el CRM: iniciar sesión (si no la hay), marcar
permisos y «Permitir». Claude Code, Cursor y otros clientes con OAuth hacen lo
mismo solos con solo la URL (`claude mcp add --transport http dayana-crm
https://www.dayanabeltran.com/api/mcp` y luego `/mcp` → autenticar).

**Cómo funciona** (especificación de autorización de MCP):

| Paso | Dónde | Norma |
|---|---|---|
| 401 con `resource_metadata` | `/api/mcp` | RFC 9728 |
| Metadatos del recurso (`resource` = `…/api/mcp`, servidor = el propio sitio) | `/.well-known/oauth-protected-resource/api/mcp` (y la raíz) | RFC 9728 |
| Metadatos del servidor | `/.well-known/oauth-authorization-server` | RFC 8414 |
| Registro del cliente | `POST /api/mcp/oauth/register` (abierto, 20/h por IP) o `client_id` = URL de su documento (CIMD) | RFC 7591 / Client ID Metadata Documents |
| Consentimiento | `/admin/autorizar-mcp` (el proxy pide sesión) → `POST /api/admin/mcp-oauth/authorize` | OAuth 2.1, PKCE S256 obligatorio, `iss` en la vuelta (RFC 9207) |
| Tokens | `POST /api/mcp/oauth/token` (`authorization_code`, `refresh_token`; 60/min por IP) | OAuth 2.1, `resource` (RFC 8707) |
| Revocación | `POST /api/mcp/oauth/revoke` | RFC 7009 |

- **Una autorización = una conexión** de `/admin/ajustes/mcp`: una fila
  `McpAccessToken` con `oauthClientId` (prefijo `oauth`, sin token propio). Se
  ve como «Inicio de sesión (OAuth)», con el nombre del cliente, y se revoca con
  el mismo botón. Volver a autorizar el mismo cliente reemplaza la conexión
  anterior. Caduca a los 90 días (hay que volver a autorizar).
- **Permisos:** los que pide el cliente (`scope`; claude.ai pide los tres) ∩ los
  del rol, y de esos los que la persona deja marcados. En cada petición se
  vuelven a recortar con el rol de hoy, igual que los tokens personales.
- **Tokens** (`McpOAuthToken`, solo su sha256): acceso `dpat_…` de 1 hora,
  refresco `dprt_…` de 30 días que **rota** en cada uso. Repetir un refresh ya
  usado (pasados 30 s, para no castigar dos refrescos simultáneos) revoca la
  conexión entera, igual que repetir un código (`dpac_…`, 10 minutos, un uso,
  atado al PKCE, a la `redirect_uri` y a la persona). El access token solo vale
  para este `/api/mcp` (su `resource`).
- **Clientes** (`McpOAuthClient`): registrarse no da acceso a nada. `redirect_uri`
  exacta (salvo el puerto de loopback, RFC 8252): https, `http://localhost` /
  `127.0.0.1` o un esquema propio; nunca `javascript:`, `data:`… Secreto (si lo
  pidió) solo en hash. Un `client_id` que es una URL https se baja (sin
  redirecciones, 5 s, 20 KB, nunca a IPs ni nombres internos) y se guarda una
  hora; tiene que ser cliente público.
- **Pantalla de consentimiento:** dice qué app, a qué dirección vuelve (claude.ai
  y chatgpt.com salen reconocidas; otra dirección sale con aviso) y qué permisos;
  «Cancelar» vuelve con `access_denied`. No se puede enmarcar (`X-Frame-Options:
  DENY` de todo el sitio) y el «Permitir» exige sesión del equipo y mismo origen
  (proxy de `/api/admin`).
- **Auditoría:** `MCP_OAUTH_CLIENT_REGISTERED` (registro), `MCP_TOKEN_CREATED`
  con `via: "oauth"`, el cliente y la dirección de vuelta, `MCP_TOKEN_REVOKED`
  con `reason` (`manual`, `replaced`, `code_reuse`, `refresh_reuse`,
  `client_revocation`), y cada `MCP_TOOL_CALL` lleva `via`.
- **Emisor:** el origen público de la petición (`X-Forwarded-Host`), así que en
  producción es `https://www.dayanabeltran.com` y en local `http://localhost:…`.
  El ápice redirige con 308, como en el resto del sitio.
