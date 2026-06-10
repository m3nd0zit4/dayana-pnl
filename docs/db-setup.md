# Base de datos CRM — Dayana PNL

Guía para dejar Neon/PostgreSQL listo y usar el panel `/admin` con datos reales.

## 1. Crear proyecto en Neon

1. Entra en [https://neon.tech](https://neon.tech) y crea un proyecto (región cercana a tus usuarios, ej. `us-east-1` o `sa-east-1`).
2. Copia **dos** connection strings en Neon → *Connection details*:
   - **Direct** → `DIRECT_URL` (migraciones, seed, Studio)
   - **Pooled** → `DATABASE_URL` (app Next.js / Vercel)

Ejemplo:

```env
# Directa (sin "-pooler" en el host)
DIRECT_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# Pooler (host con "-pooler"; obligatorio pgbouncer con Prisma)
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=1&connect_timeout=15"
```

En `DIRECT_URL` puedes usar `channel_binding=require`; en `DATABASE_URL` (pooler) **no** lo añadas — PgBouncer y channel binding no combinan bien.

Pégalas en tu `.env` local (no las subas a git). Si ves `prisma:error … connection: Closed` en `bun dev`:

1. Confirma que `DATABASE_URL` usa el host **pooler** con `pgbouncer=true`.
2. Reinicia `bun dev` tras cambiar `.env` (HMR deja sockets viejos).
3. La app usa el driver Neon (`@prisma/adapter-neon` en `lib/db.ts`) con reintento automático.

## 2. Variables obligatorias en `.env`

| Variable | Para qué |
|----------|----------|
| `DIRECT_URL` | Migraciones Prisma, seed, Studio |
| `DATABASE_URL` | App (pooler Neon + `pgbouncer=true`) |
| `AUTH_SECRET` | Login staff (`openssl rand -base64 32`). Sesión **30 días** por dispositivo. Ver `docs/security-crm.md`. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Opcional: rate limit distribuido en login y pagos |
| `STAFF_OWNER_EMAIL` | Usuario OWNER del seed |
| `STAFF_OWNER_PASSWORD` | Contraseña del OWNER |
| `STAFF_OWNER_NAME` | Nombre visible en el panel |

Opcional en local:

```env
# CRM_UI_PREVIEW=true   # quitar cuando uses DB real
```

Las variables de PayPal, Mercado Pago, webhooks e Inngest son para pagos/automatización; el CRM básico solo necesita las de arriba.

## 3. Comandos (en orden)

Desde la raíz del repo:

```bash
bun install
bunx prisma generate
bun run db:migrate:deploy
bun run db:seed
```

- **`db:migrate:deploy`**: aplica `prisma/migrations/` (tablas contacts, enrollments, payments, staff, talleres, etc.).
- **`db:seed`**: carga productos desde `lib/plans.ts`, talleres desde `lib/workshops.ts`, tags, plantillas WA y el usuario OWNER.

Si `prisma generate` falla en Windows con `EPERM`, cierra el dev server y vuelve a ejecutar.

## 4. Probar login

1. Quita o comenta `CRM_UI_PREVIEW` en `.env`.
2. `bun dev`.
3. Abre `http://localhost:3000/admin/sign-in`.
4. Entra con `STAFF_OWNER_EMAIL` y `STAFF_OWNER_PASSWORD`.

## 5. Qué crea el seed

| Tabla | Contenido |
|-------|-----------|
| `products` / `product_prices` | Planes de terapia, cursos, taller |
| `workshop_editions` | Ediciones de taller virtual |
| `staff_users` | Tu usuario OWNER (bcrypt) |
| `tags` | Etiquetas CRM (interes-taller, etc.) |
| `message_templates` | Plantillas WhatsApp asistidas |

Los **contactos** y **enrollments** los creas desde el panel o llegan por checkout/webhooks.

## 6. Explorar datos

```bash
bun run db:studio
```

Abre Prisma Studio en el navegador.

## 7. Producción (Vercel u otro)

1. Añade las mismas env vars en el hosting.
2. En el build/deploy ejecuta `prisma migrate deploy` (ya va en `npm run build` vía `prisma generate`).
3. Ejecuta el seed **una vez** en producción (CLI con `DATABASE_URL` de prod) o crea el OWNER manualmente.
4. **Nunca** uses `CRM_UI_PREVIEW=true` en producción.

## 8. Checklist rápido

- [ ] `DIRECT_URL` y `DATABASE_URL` (pooler + `pgbouncer=true`) en `.env`
- [ ] `AUTH_SECRET` generado
- [ ] `STAFF_OWNER_*` definidos
- [ ] `bun run db:migrate:deploy` sin errores
- [ ] `bun run db:seed` — mensaje de staff creado
- [ ] Login en `/admin/sign-in` OK
- [ ] Crear un contacto de prueba en `/admin/contacts`

## 9. Modelo ↔ formularios del CRM

| Pantalla | Tabla(s) principal(es) |
|----------|-------------------------|
| Contactos | `contacts` (teléfono E.164, origen, consentimientos, notas) |
| Servicios | `enrollments` + `products` (+ `workshop_editions` si es taller) |
| Pagos | `payments` → `enrollments` |
| Talleres | `workshop_editions` |
| Productos | `products` (lectura; edición vía seed/planes) |
| Plantillas WA | `message_templates` |
| Equipo | `staff_users` |

Campos de contacto en el formulario: `phone_e164`, `phone_country_iso`, `first_name`, `last_name`, `display_name`, `email`, `country_iso`, `timezone`, `preferred_locale`, `source`, `source_detail`, `tiktok_handle`, `notes`, `consent_data_at`, `consent_marketing_at`.
