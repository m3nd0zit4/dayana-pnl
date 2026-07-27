# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
bun dev                        # dev server
bun run build                  # prisma-generate + migrate deploy + next build
npm run lint                   # ESLint
npm run typecheck              # tsc --noEmit
bun run db:migrate             # prisma migrate dev (local schema changes)
bun run db:migrate:deploy      # prisma migrate deploy (CI/prod)
bun run db:seed                # seed products + OWNER staff
bun run db:studio              # Prisma Studio
bun run email:sample           # test Resend email
bun run env:pull               # pull preview env from Vercel
```

## Architecture

**Next.js 16 + React 19** — public site at `/` and CRM staff panel at `/admin`. Two distinct surfaces sharing one codebase.

### Layers

| Path | Role |
|------|------|
| `app/` | Next.js App Router pages, layouts, API routes, components |
| `lib/` | Server-side business logic — no React, no Next.js imports |
| `prisma/schema.prisma` | Single source of truth for the DB schema |
| `auth.ts` | NextAuth v5 (beta) — credentials-only, JWT strategy, DB session rows in `StaffSession` |

### Database

Neon (serverless PostgreSQL) via `@prisma/adapter-neon`. Singleton in `lib/db.ts` auto-reconnects on connection-closed errors (3 retries). `DATABASE_URL` = pooled connection; `DIRECT_URL` = direct for migrations.

### Auth (CRM only)

NextAuth credentials provider at `/admin/sign-in`. Staff roles: `OWNER > OPERATOR > READONLY > DEVELOPER`. In-memory login rate-limiting (`lib/auth/login-rate-limit.ts`); DB session rows in `StaffSession` validated on every JWT callback.

### Payment flow

1. Checkout creates `Enrollment` with `PENDING_PAYMENT` — `externalRef` = enrollmentId.
2. PayPal or Mercado Pago webhook → `Payment` (APPROVED) + `Enrollment` → `ACTIVE` + optional `TherapyPackage`.
3. `/pago/exito` captures contact details post-payment.

Pricing: amounts stored as **minor units** (centavos/cents). USD→COP rate resolves: `SiteSetting` DB row → `USD_TO_COP_RATE` env var → 3500 fallback (`lib/pricing/usd-to-cop.ts`).

### Async / background jobs (Inngest)

`lib/inngest/functions.ts` defines all functions:
- `payment-approved` — fires payment confirmation notifications
- `therapy-session-reminder` — cron 14:00 UTC daily
- `lead-stale-followup` — triggered by `enrollment/lead.stale`
- `notification-campaign-run` — batched broadcast
- `stale-checkout-cleanup` — cron 05:00 UTC daily
- `platform-notification-email` — email fan-out for a platform notification
- `notification-retention` — cron 06:00 UTC daily, prunes old feed rows

### Notifications

Two separate systems. Don't confuse them.

**Outbound messaging** — `lib/notifications/` dispatches via email (Resend), SMS, WhatsApp API. Gated by `NOTIFICATIONS_ENABLED=true` and `NOTIFICATIONS_DRY_RUN`. `dispatchAndRecord` writes a `NotificationDelivery` row regardless of outcome. Note `NOTIFICATIONS_DRY_RUN` **defaults to ON outside production** — check `/admin/ajustes/integraciones`, which surfaces it as a `degraded` state, before concluding a send failed.

**In-app feed** — `lib/notifications/platform/` powers the bell in the CRM top bar and the member portal.

- `catalog.ts` is the single source of truth: every event type maps to its Spanish label, group, severity, audience (`STAFF` / `MEMBER` / `BOTH`), default routing, receiving staff roles, and optional `coalesceWindowSec`. It drives rendering, the preferences matrix, and recipient resolution. **To add an event: add it to the `NotificationEventType` enum in `schema.prisma`, migrate, then add its catalog entry** — the `Record` is exhaustive, so TypeScript will fail until you do.
- `emit.ts` — `fireNotification` (non-blocking, for request paths) and `emitPlatformNotification` (awaited, for Inngest steps / eve tools). Recipients are always explicit; audience-wide sends go through `broadcastPlatformNotification`, which caps at 2000 and chunks inserts.
- Storage is one `PlatformNotification` row per event plus a `NotificationRecipient` row per person, carrying `readAt` / `dismissedAt` / `emailedAt`.
- Staff preferences are absence-defaulted: **no row means "use the catalog default"**, so adding an event type never needs a backfill. `StaffUser.notifyEmail` is a master switch AND-ed over the per-event flag. Members get one `Contact.notifyInApp` toggle, not a matrix.
- Freshness is SSE (`/api/*/notifications/stream`), which is server-side polling over a held socket — Neon has no usable `LISTEN/NOTIFY` here. The client elects one leader tab per browser over a `BroadcastChannel`. `NOTIFICATIONS_STREAM_ENABLED=false` degrades it to 60s polling; use that if function concurrency or cost becomes a problem.
- Retention windows and per-event kill switches are `SiteSetting` rows, editable at `/admin/ajustes/notificaciones` without a deploy.

`fireNotification` uses `after()` from `next/server`, falling back to a plain promise outside a request scope. Prefer that over a bare floating promise anywhere new — on Vercel the invocation can freeze once the response is returned, silently dropping the write.

### Geo-based pricing

User country is resolved server-side from `x-vercel-ip-country` header via `lib/geo/user-country.ts`. `lib/pricing/regions.ts` maps country ISO to a `PricingRegion` (currency + payment provider): Colombia → COP + Mercado Pago; everywhere else → USD + PayPal.

### Plans / Products

`lib/plans.ts` holds static fallback plan definitions (`PLANS` map keyed by product id). `lib/plans-from-db.ts` reads live `Product` + `ProductPrice` rows and merges them with the static fallbacks via `productToPlan`. Always use `getPublicPlans()` or `getPlanFromDb()` from `lib/plans-from-db.ts` to get prices — never read `PLANS` directly for public-facing amounts.

COP prices are stored as **full pesos** (no centavos), so `amountMinor` for COP = pesos directly. USD prices follow standard minor-units (cents).

### CRM lib conventions

- All DB access goes through `lib/crm/*.ts` — never query Prisma directly from API routes.
- `lib/crm/index.ts` is the barrel export for CRM operations.
- Audit trail: call `writeAuditLog` from `lib/crm/audit.ts` on destructive ops.

### Key env vars

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Neon pooled |
| `DIRECT_URL` | Neon direct (migrations) |
| `AUTH_SECRET` | NextAuth secret (≥32 chars in prod) |
| `PAYPAL_MODE` | `sandbox` or `live` |
| `MERCADOPAGO_ACCESS_TOKEN` | Must be production token (not `TEST-`) in prod |
| `NOTIFICATIONS_ENABLED` | `true` to actually send |
| `NOTIFICATIONS_DRY_RUN` | `true` to skip external calls — **defaults ON outside production** |
| `NOTIFICATIONS_STREAM_ENABLED` | `true` for SSE on the bell; unset falls back to 60s polling |
| `NOTIFICATIONS_PRUNE_DELIVERIES` | `true` to let the retention cron prune `NotificationDelivery` |
| `UPSTASH_REDIS_REST_URL/TOKEN` | Distributed rate limiting |
| `CRM_UI_PREVIEW` | `true` only in preview — disables auth for UI preview |

Production env validated at startup via `lib/env.server.ts` (Zod schema, throws on missing vars).
