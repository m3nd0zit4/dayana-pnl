# Entorno de desarrollo aislado

**Un solo archivo local:** `.env` — alineado con **Vercel Preview** (rama `dev`).

```bash
bun run env:pull   # Vercel Preview → .env
```

No uses `.env.local` ni copias paralelas.

## Arquitectura

| Entorno | Git | Vercel | `.env` / variables | Base de datos |
|---------|-----|--------|-------------------|---------------|
| **Producción** | `main` | Production | Solo en Vercel Dashboard | `neondb` |
| **Desarrollo** | `dev` | Preview (dev) | `.env` local + Preview en Vercel | `neondb_dev` |

## Base de datos `neondb_dev`

Misma instancia Neon, base distinta de producción (`neondb`).

Recrear si hace falta:

```bash
echo "CREATE DATABASE neondb_dev;" | npx prisma db execute --stdin --url "<DIRECT_URL_sin_neondb_dev>"
bun run db:migrate:deploy
bun run db:seed
```

## Local (`bun dev`)

1. `.env` con `DATABASE_URL` / `DIRECT_URL` → `/neondb_dev`
2. `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
3. `bun run env:pull` para refrescar desde Vercel Preview
4. `bun dev` (reinicia tras cambiar `.env`)

**¿Qué DB uso?** Mira el path en `DATABASE_URL`: `neondb_dev` = dev, `neondb` = prod.

```bash
npx prisma migrate status   # muestra database "neondb_dev" o "neondb"
```

## Vercel Preview (rama `dev`)

Variables obligatorias en **Preview (dev)**:

| Variable | Valor |
|----------|--------|
| `DATABASE_URL` | pooler → `/neondb_dev` |
| `DIRECT_URL` | directa → `/neondb_dev` (también en **Build**) |
| `AUTH_SECRET` | login staff |

Si el build falla con `DIRECT_URL not found`, asegura `DATABASE_URL` en Vercel Preview (rama `dev`) con **Build** habilitado. El script de build deriva `DIRECT_URL` del pooler si falta.

## Inngest en local

```bash
bun dev
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

## Comandos

| Comando | Uso |
|---------|-----|
| `bun run env:pull` | Vercel Preview → `.env` |
| `bun run env:pull:production` | Solo referencia prod → `.env.production` (secretos vacíos) |
| `bun run db:migrate:deploy` | Migra la DB del `.env` actual |
| `bun run db:seed` | Catálogo + OWNER |

## Errores frecuentes

**Datos de prod en local:** `.env` aún apunta a `/neondb`. Cambia a `neondb_dev` o `bun run env:pull`.

**Build Preview falla:** falta `DIRECT_URL` en Vercel Preview (dev).
