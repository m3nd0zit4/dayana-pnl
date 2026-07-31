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
- `meta-webhook-received` — inbound Meta messages, serialized per thread
- `social-post-scheduler` — cron every 5 min, claims due posts
- `social-post-publish` — publishes one post (`retries: 0` on purpose — a blind retry could upload the same video twice)

### Notifications

Two separate systems. Don't confuse them.

**Outbound messaging** — `lib/notifications/` dispatches via email (Resend), SMS, WhatsApp API. Gated by `NOTIFICATIONS_ENABLED=true` and `NOTIFICATIONS_DRY_RUN`. `dispatchAndRecord` writes a `NotificationDelivery` row regardless of outcome. Note `NOTIFICATIONS_DRY_RUN` **defaults to ON outside production** — check `/admin/ajustes/integraciones`, which surfaces it as a `degraded` state, before concluding a send failed.

Every outbound email — transactional, campaign, and the agent's own send tools — converges on `dispatchToChannel` (`lib/notifications/dispatch.ts`). Only sends with a `campaignId` (real bulk campaigns, from `/admin/messages` or `agent/tools/send_bulk_email.ts`) get a `List-Unsubscribe`/`List-Unsubscribe-Post` header and a visible unsubscribe footer link (`lib/notifications/unsubscribe-token.ts` signs the token, `app/api/unsubscribe/route.ts` handles it) — **don't** add these to a 1:1 send. `List-Unsubscribe` is exactly the signal Gmail's classifier uses to route a message into Promotions instead of Primary, so putting it on every email (payment confirmations, the agent's 1:1 replies) misfiles them; confirmed empirically (`category:promotions` search) before this was scoped down to `campaignId`-only. `app/api/webhooks/resend/route.ts` listens for `email.bounced`/`email.complained` and flips `Contact.notifyEmail` off automatically — don't re-enable it for a contact without checking why it went off. The agent's own bulk-send tool (`agent/tools/send_bulk_email.ts`, OWNER-only) reuses the same `lib/notifications/campaigns.ts` batch pipeline as `/admin/messages` — there is still no bulk SMS/WhatsApp tool.

**In-app feed** — `lib/notifications/platform/` powers the bell in the CRM top bar and the member portal.

- `catalog.ts` is the single source of truth: every event type maps to its Spanish label, group, severity, audience (`STAFF` / `MEMBER` / `BOTH`), default routing, receiving staff roles, and optional `coalesceWindowSec`. It drives rendering, the preferences matrix, and recipient resolution. **To add an event: add it to the `NotificationEventType` enum in `schema.prisma`, migrate, then add its catalog entry** — the `Record` is exhaustive, so TypeScript will fail until you do.
- `emit.ts` — `fireNotification` (non-blocking, for request paths) and `emitPlatformNotification` (awaited, for Inngest steps / eve tools). Recipients are always explicit; audience-wide sends go through `broadcastPlatformNotification`, which caps at 2000 and chunks inserts.
- Storage is one `PlatformNotification` row per event plus a `NotificationRecipient` row per person, carrying `readAt` / `dismissedAt` / `emailedAt`.
- Staff preferences are absence-defaulted: **no row means "use the catalog default"**, so adding an event type never needs a backfill. `StaffUser.notifyEmail` is a master switch AND-ed over the per-event flag. Members get one `Contact.notifyInApp` toggle, not a matrix.
- Freshness is SSE (`/api/*/notifications/stream`), which is server-side polling over a held socket — Neon has no usable `LISTEN/NOTIFY` here. The client elects one leader tab per browser over a `BroadcastChannel`. `NOTIFICATIONS_STREAM_ENABLED=false` degrades it to 60s polling; use that if function concurrency or cost becomes a problem.
- Retention windows and per-event kill switches are `SiteSetting` rows, editable at `/admin/ajustes/notificaciones` without a deploy.

`fireNotification` uses `after()` from `next/server`, falling back to a plain promise outside a request scope. Prefer that over a bare floating promise anywhere new — on Vercel the invocation can freeze once the response is returned, silently dropping the write.

### Social channels (Meta inbox + TikTok publishing)

Two surfaces, one shared account store.

**Inbox** (`/admin/inbox`) — WhatsApp, Instagram DMs and Facebook Messenger in one thread list. All three arrive at **one webhook**, `app/api/webhooks/meta/route.ts`, discriminated by the payload's top-level `object` field. Signature verification runs over the **raw body** (`verifyMetaWebhook`), so the route reads `req.text()` once and parses from that string — re-serializing the JSON changes the bytes the HMAC covers.

- `lib/meta/inbound.ts` normalizes all three shapes into `NormalizedEvent`; nothing downstream knows the differences. It never throws — an unrecognized payload yields `[]`, because a 500 just makes Meta retry the same broken thing.
- Work is queued on Inngest with `concurrency: { key: threadKey, limit: 1 }`. That serialization is the point: without it three fast messages from one person are processed in parallel and the thread reads out of order. If Inngest is unconfigured the route falls back to inline processing via `after()` — a customer message must not vanish because an env var is unset.
- Idempotency is `MetaWebhookEvent.eventId`, keyed on the **message** id (`wamid…`/`mid…`), not the delivery — Meta re-sends the same message inside different envelopes.
- Echoes (`is_echo`) are stored as OUTBOUND, not dropped: when Dayana replies from her phone the CRM thread stays correct.
- Meta closes the reply window 24 h after the customer's last message. `lib/meta/window.ts` resolves `free | template | human_agent | closed`; out-of-window WhatsApp requires an **approved template** (`MessageTemplate.metaTemplateName` + `metaApprovalStatus`), and Messenger/Instagram get the `HUMAN_AGENT` tag up to 7 days. The composer reflects this rather than letting Meta reject the send.
- Instagram and Messenger give an opaque PSID/IGSID — **never a phone or email**. An unlinked conversation is a normal state. `ContactChannelIdentity` records a manual link so the next thread from that person resolves automatically.

**Publishing** (`/admin/contenido`) — schedule and publish TikTok videos. Note the hard limits: **TikTok has no DM API** for an ordinary app (Business Messaging is a partner-only beta) and its comment endpoints all require `advertiser_id`, so they cover ads and not organic posts. There is no TikTok inbox to build. Uploads use chunked `FILE_UPLOAD`, not `PULL_FROM_URL`, because TikTok only pulls from domains verified in its console and the media lives on Vercel Blob. Unaudited apps may only post `SELF_ONLY`; `enforcePrivacyLevel` applies that at save time rather than letting the cron discover it. `TIKTOK_AUDITED=true` lifts it.

**Connections** (`/admin/ajustes/conexiones`, OWNER only) — one-click OAuth linking. Connecting a Meta Page also calls `POST /{page-id}/subscribed_apps`, which is what removes the manual webhook step in Meta's console and covers Messenger *and* Instagram at once.

- `lib/social/oauth-state.ts` is the shared signed state for every provider. It **throws** when `AUTH_SECRET` is missing (an empty key would make every forged state verify), puts the provider inside the signature so a TikTok state cannot be replayed at the Meta callback, and binds the state single-use to the browser with an httpOnly nonce cookie. The redirect target is one character inside the signature resolved through a frozen map — no request value ever becomes a URL.
- `lib/meta/credentials.ts` resolves page credentials **DB first, env fallback**. `lib/meta/client.ts` keeps its sync signatures; only `send.ts` and `ingest.ts` call the async resolver. With no linked account the env path behaves exactly as before, so a System User token in Vercel keeps working.
- There is **no auto-refresh**: Meta long-lived tokens cannot be extended without a human, so the screen shows a countdown and a Reconnect button. A code-190 failure marks the connection down and rewrites the thread error to say who can fix it, since an OPERATOR cannot open that screen.
- **Disconnect deactivates, never deletes** — `SocialPost.account` cascades, so deleting an account would take its publishing history with it.
- `getSocialConnections()` (`lib/crm/social-accounts.ts`) is the DB-backed twin of `getIntegrationHealth()`. It lives separately because the latter is deliberately pure-env and zero-I/O so `ajustes/integraciones` can call it synchronously — don't put DB reads in it.

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
| `RESEND_WEBHOOK_SECRET` | Signs `/api/webhooks/resend` (bounce/complaint → auto-suppress `Contact.notifyEmail`) |
| `NOTIFICATIONS_PRUNE_DELIVERIES` | `true` to let the retention cron prune `NotificationDelivery` |
| `UPSTASH_REDIS_REST_URL/TOKEN` | Distributed rate limiting |
| `CRM_UI_PREVIEW` | `true` only in preview — disables auth for UI preview |
| `META_INBOX_ENABLED` | `true` to show `/admin/inbox` and accept its API routes |
| `META_APP_SECRET` | HMAC key for `X-Hub-Signature-256`; also the OAuth code exchange |
| `META_LOGIN_CONFIG_ID` | Facebook Login for Business config — replaces `scope` |
| `META_PAGE_ID` / `META_PAGE_ACCESS_TOKEN` | **Fallback** only; a linked account in the DB wins |
| `SOCIAL_PUBLISHING_ENABLED` | `true` to show `/admin/contenido` |
| `TIKTOK_AUDITED` | `true` only after TikTok's audit — until then every post is forced `SELF_ONLY` |

Production env validated at startup via `lib/env.server.ts` (Zod schema, throws on missing vars).
