# Dayana Beltrán PNL

Sitio público + CRM staff (`/admin`) — Next.js 16, Neon PostgreSQL, Prisma, NextAuth, Vercel.

## Desarrollo local

```bash
cp .env.example .env
# Completa DATABASE_URL, DIRECT_URL, AUTH_SECRET, etc.

bun install
bun run db:migrate:deploy
bun run db:seed
bun dev
```

Panel: [http://localhost:3000/admin/sign-in](http://localhost:3000/admin/sign-in)

Sincronizar env desde Vercel: `bun run env:pull`

## Producción

Merge a `main` → deploy automático en Vercel.

**Antes del merge**, completa:

- [`docs/proximos-pasos.md`](docs/proximos-pasos.md) — checklist
- [`docs/production-deploy.md`](docs/production-deploy.md) — dashboards (PayPal, MP, Inngest, Upstash)
- [`docs/security-crm.md`](docs/security-crm.md) — seguridad CRM

## Scripts

| Comando | Uso |
|---------|-----|
| `bun dev` | Servidor desarrollo |
| `npm run build` | generate + migrate deploy + build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `bun run db:seed` | Productos + OWNER inicial |
| `bun run email:sample` | Probar correo Resend |

## Documentación

- [`docs/db-setup.md`](docs/db-setup.md) — Neon + Prisma
- [`docs/inngest-setup.md`](docs/inngest-setup.md) — automatizaciones
- [`docs/notifications-setup.md`](docs/notifications-setup.md) — correo/SMS
