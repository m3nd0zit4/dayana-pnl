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

### Design system

Two documents, and they are not interchangeable:

- **`DESIGN.md`** — the visual language: type scale, the colour tokens, spacing, radii, what not to do. Applies everywhere.
- **`docs/crm-ui-contract.md`** — the ten layout rules for `/admin`: where the primary action goes, how lists and empty states are built, what a public-page link looks like, modal footer order. **Read it before touching anything under `app/components/admin/crm/`.**

The contract is not advisory. `e2e/crm-contract.spec.ts` asserts it on the 15 CRM routes that render under `CRM_UI_PREVIEW`, and `bun run check:tokens` catches hardcoded colours that render fine and so slip past typecheck, lint and the browser alike. The primitives that implement the rules live in `app/components/admin/crm/ui/` — use them rather than re-deriving the markup, which is exactly how the panel ended up with five different "see the public page" buttons.

Dark mode is live on `/admin` and `/miembros`. Anything pinned to a light value will look broken when someone toggles it.

### Database

Neon (serverless PostgreSQL) via `@prisma/adapter-neon`. Singleton in `lib/db.ts` auto-reconnects on connection-closed errors (3 retries). `DATABASE_URL` = pooled connection; `DIRECT_URL` = direct for migrations.

### Auth (CRM only)

NextAuth credentials provider at `/admin/sign-in`. Staff roles: `OWNER > OPERATOR > READONLY > DEVELOPER`. In-memory login rate-limiting (`lib/auth/login-rate-limit.ts`); DB session rows in `StaffSession` validated on every JWT callback.

### Payment flow

1. Checkout creates `Enrollment` with `PENDING_PAYMENT` — `externalRef` = enrollmentId.
2. PayPal or Mercado Pago webhook → `Payment` (APPROVED) + `Enrollment` → `ACTIVE` + optional `TherapyPackage`.
3. `/pago/exito` captures contact details post-payment.

Pricing: amounts stored as **minor units** (centavos/cents). USD→COP rate resolves: `SiteSetting` DB row → `USD_TO_COP_RATE` env var → 3500 fallback (`lib/pricing/usd-to-cop.ts`).

#### Lemon Squeezy — the international rail

**Colombia → Mercado Pago (COP). Everywhere else → Lemon Squeezy (USD).** That split is the whole design and it is not arbitrary: LS is merchant of record and accepts Colombian merchants with no US entity — which is why it exists here at all — but its checkout has **no PSE, no Nequi, no cash**, so pointing Colombian buyers at it would trade the local rail for an international card. `lib/pricing/regions.ts` holds the split. PayPal is retired from the UI; its routes and webhook stay deployed so in-flight orders still settle.

- **Two flags, deliberately separate.** `LEMONSQUEEZY_CHECKOUT_ENABLED` opens the endpoint, `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_ENABLED` paints the button. Server-on/public-off is the production verification state — live, reachable by you, invisible to customers. With the public flag off the UI falls back to PayPal, so a deploy is inert until flipped.
- **`providerPaymentId` is namespaced: `order:<id>` / `subinv:<id>`.** LS order ids and subscription-invoice ids are bare integers from different sequences; unprefixed they collide in `@@unique([provider, providerPaymentId])` and a renewal silently no-ops against an unrelated order.
- **A subscription purchase fires `order_created` AND `subscription_payment_success`.** `syncLemonSqueezyOrder` bails out when `Product.lemonSqueezySubscription` is true — `subscription_payment_success` is the single recording path for the membership, first invoice included (`billing_reason: initial | renewal | updated`). Record both and you write two `Payment` rows for one charge and grant two months.
- **`custom_price` is one-off only.** It carries the fee gross-up per request, so `LEMONSQUEEZY_FEE_*` changes take effect immediately — the opposite of Stripe, where the gross-up is baked into a `Price` object. The recurring variant uses its real LS price because `custom_price` on subscription variants is undocumented.
- **LS is merchant of record**: it sends its own receipts and invoices. Don't add a payment-confirmation email for these — you'd be the second sender. Amounts are recorded from `total_usd` in USD; LS bills in the customer's currency and reports the USD equivalent.
- **The webhook drops `test_mode` payloads when `VERCEL_ENV=production`.** LS test and live API keys are not distinguishable by prefix, so there is no `sk_test_`-style env guard — this is the substitute, and it is what stops a test event granting real access.
- `/pago/exito?ls=1&ref=…` resolves the enrollment through `findEnrollmentForCheckout`. `ref` is **not** a trust boundary: it only reads an enrollment a signature-verified webhook already created. Not-found means "processing", not "failed".

#### Stripe / Managed Payments

A **third** rail alongside PayPal and Mercado Pago, not a replacement. Everything is behind `STRIPE_CHECKOUT_ENABLED` (server) + `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED` (button); unset, the panel and the checkout behave exactly as before. `POST /api/checkout/stripe` → hosted Checkout → `POST /api/webhooks/stripe`.

- **Managed Payments is per product, not per integration.** `Product.stripeManagedPayments` decides `managed_payments: { enabled }` on the session. Stripe only covers **fully digital, fully automated** goods — it explicitly excludes human-delivered services ("live 1-1 coaching") and live events, so the therapy plans and `workshop-virtual` run as ordinary Stripe Checkout with Dayana as merchant of record. `course-live` ships ON as `txcd_20060158`; it also carries live Meet classes, so if Stripe rules it ineligible, flip the column — no deploy. `lib/payments/stripe/eligibility.ts` holds the tax-code list and the reasoning.
- **When it's on, Link is the merchant of record.** Receipts, invoices and refund notices come from Link, not our Resend templates, and the statement reads `LINK.COM* …`. Don't add a payment-confirmation email for these; you'd be the second sender.
- **The fee gross-up is baked into the Stripe `Price`**, unlike PayPal/MP which gross up per request — Checkout charges Price objects. Changing `STRIPE_FEE_PERCENT`/`STRIPE_FEE_FIXED` means re-running `bunx tsx scripts/stripe/setup-products.ts`. Managed Payments then adds tax **on top** (`tax_behavior: exclusive`).
- **The Stripe ids live on `Product`, never on `ProductPrice`.** `ProductPrice` is the public price history and its newest USD row is what the site renders — writing the grossed-up amount there would inflate the displayed price on every run.
- **`mode: subscription` is fulfilled by `invoice.paid`, not by `checkout.session.completed`.** Recording both would write two `Payment` rows for one charge and grant two membership months. The checkout reference rides on `subscription_data.metadata` and survives renewals via `invoice.parent.subscription_details.metadata`.
- Everything converges on `fulfillCheckoutPayment`, so the COURSE-renewal, membership-extension, promo-redemption and Meta CAPI dedupe logic is shared with the other two providers. `/pago/exito` reconciles `?session_id=` the same way it does Mercado Pago's `payment_id`, so a missing webhook can't lose a payment.
- A failed handler **deletes** its `WebhookEvent` row (`releaseWebhookEvent`) before returning 500 — otherwise Stripe's retry short-circuits as a duplicate and the payment is never recorded. Safe because fulfilment is idempotent per provider payment id.
- Managed Payments is incompatible with Connect, Elements/advanced integrations, custom domains, and subscriptions created outside Checkout. Business location must be a supported country — **Colombia is not one**.

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
- `webinar-mailer` — cron `3-53/10` (offset to dodge the `*/5` social scheduler), sweeps the free-webinar Meet-link and 24 h / 1 h reminder queues
- `webinar-meet-link-broadcast` — triggered by `webinar/meet-link.changed` so a freshly saved link goes out immediately instead of waiting up to 10 min for the cron

### Notifications

Two separate systems. Don't confuse them.

**Outbound messaging** — `lib/notifications/` dispatches via email (Resend), SMS, WhatsApp API. Gated by `NOTIFICATIONS_ENABLED=true` and `NOTIFICATIONS_DRY_RUN`. `dispatchAndRecord` writes a `NotificationDelivery` row regardless of outcome. Note `NOTIFICATIONS_DRY_RUN` **defaults to ON outside production** — check `/admin/ajustes/integraciones`, which surfaces it as a `degraded` state, before concluding a send failed.

Every outbound email — transactional, campaign, and the agent's own send tools — converges on `dispatchToChannel` (`lib/notifications/dispatch.ts`). Only sends with a `campaignId` (real bulk campaigns, from `/admin/messages` or `agent/tools/send_bulk_email.ts`) get a `List-Unsubscribe`/`List-Unsubscribe-Post` header and a visible unsubscribe footer link (`lib/notifications/unsubscribe-token.ts` signs the token, `app/api/unsubscribe/route.ts` handles it) — **don't** add these to a 1:1 send. `List-Unsubscribe` is exactly the signal Gmail's classifier uses to route a message into Promotions instead of Primary, so putting it on every email (payment confirmations, the agent's 1:1 replies) misfiles them; confirmed empirically (`category:promotions` search) before this was scoped down to `campaignId`-only. `app/api/webhooks/resend/route.ts` listens for `email.bounced`/`email.complained` and flips `Contact.notifyEmail` off automatically — don't re-enable it for a contact without checking why it went off. The agent's own bulk-send tool (`agent/tools/send_bulk_email.ts`, OWNER-only) reuses the same `lib/notifications/campaigns.ts` batch pipeline as `/admin/messages` — there is still no bulk SMS/WhatsApp tool.

**SMS (Twilio)** — two webhooks, both verified with `verifyTwilioWebhook` (HMAC-SHA1 over *the configured URL* + sorted form params; the URL comes from `TWILIO_WEBHOOK_BASE_URL`/`NEXT_PUBLIC_SITE_URL`, **never** `req.url`, whose host is the internal deployment behind Vercel's proxy).

- `/api/webhooks/twilio` — inbound STOP/BAJA/START/AYUDA. It flips `Contact.notifySms` and always applies the write, even in dry-run: an opt-out is inbound bookkeeping, not a send. The **reply** is what's suppressed (and rate-limited to 3/h per number — every TwiML reply is a billed segment). When Twilio sets `OptOutType` it already handled the keyword and replied itself, so we stay silent and only sync the DB; for `+57` Twilio does not process keywords at all, which is the whole reason this route exists. Auto-reply copy is deliberately accent-free — one accented char drops GSM-7 from 160 chars/segment to UCS-2's 70.
- `/api/webhooks/twilio/status` — `StatusCallback`, attached per message. `delivered` stamps `NotificationDelivery.deliveredAt`; `failed`/`undelivered` flip the row to `FAILED` (**unlike** the Resend webhook, which leaves `SENT` intact — a bounce is a fact about the address after a real handoff, while Twilio's failure means this message never arrived). Permanent codes only (`21610/21211/21614/30005/30006`) auto-suppress `notifySms`; `30003` is transient and `30007` is carrier filtering, i.e. a 10DLC/content problem, so suppressing the contact there would blame the wrong party. Everything uses `updateMany` with `deliveredAt: null` / `status: { not: FAILED }` guards, so retries and out-of-order callbacks are idempotent and a pruned row is a no-op.
- **Two senders.** `smsFromNumber(kind)` picks `TWILIO_MARKETING_FROM_NUMBER` for anything carrying a `campaignId` — the same predicate that decides `List-Unsubscribe` — and the base number otherwise. Marketing falls back to the base number; transactional **never** falls back to marketing, because each US number belongs to one 10DLC campaign with a declared use case and a payment receipt sent from a Marketing-registered number is what gets that campaign suspended. `smsProviderReady()` stays at three vars on purpose: adding the optional fourth would switch the whole channel off, and adding it to `SMS_REQUIRED_ENV` would make the agent's SMS tool refuse to send.

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

### Free webinar funnel (`/webinar-gratuito` + `/admin/webinar`)

One `FreeWebinar` row (slug `gratuito`) holds the landing copy, the schedule, the Meet link and the promo video. Registrations arrive through the shared `/api/leads` endpoint, which tags the contact `webinar-gratuito` **and** writes a `WebinarRegistration` row.

- **`WebinarRegistration` exists for the send state, not the list.** `linkEmailSentAt` / `reminder24hSentAt` / `reminder1hSentAt` make "who still needs this" a query instead of a time window, so a late, retried, or double-deployed cron can't double-send. Claim the column (`updateMany` where it `IS NULL`) *before* sending and release it if the send didn't land.
- **`updateFreeWebinar` writes `meetUrl` with a compare-and-swap** and returns `meetUrlChanged`. The database answers "did it really change", so re-saving the same link — or the same link with a trailing space, hence `normalizeMeetUrl` — can never trigger a mass email. A real change clears `linkEmailSentAt` on every row: **that reset is the re-send.** Write first, reset second, or a concurrent fan-out sends the old link and stamps it.
- **A changed `startsAt` clears both reminder columns.** Without it, rescheduling silently leaves everyone with reminders already marked sent.
- Fan-out goes through `dispatchAndRecord` (honors `Contact.notifyEmail`, writes `NotificationDelivery`) with **no `campaignId`** — see the notifications section on why `List-Unsubscribe` must not touch 1:1 mail. Contacts without an email or with `notifyEmail` off are excluded by the `where`, never by stamping — stamping would permanently strand someone who adds an email later.
- When a link already exists at registration time, the confirmation email carries it and `linkEmailSentAt` is stamped on create, so the fan-out doesn't send a duplicate minutes later.
- **The live edition is always `slug = "gratuito"`. That is the invariant.** Archiving renames the finished row to `gratuito-<id>` and creates a fresh `gratuito` inside one transaction, so every caller that resolves by that slug — landing, `/enlaces`, sitemap, agent tools, mailer, `/api/leads` — keeps working untouched. `archivedAt` is a display timestamp, **never a predicate**; `slug @unique` is what enforces "at most one live edition".
- **Archiving carries the template forward and leaves the edition's facts behind.** The new row inherits copy, FAQ and the promo video; it does **not** inherit `startsAt` or `meetUrl`. Inheriting `meetUrl` would mail a dead link or — worse — make the compare-and-swap see "no change" when the same recurring room is re-pasted, so nobody would get it. The archived row also has `muxUploadId`/`muxAssetId` nulled, because the Mux webhook matches on those with `updateMany` and two rows sharing them means one webhook writes to both.
- **`endedAt` is sealed by the `webinar-mailer` cron, never automatically archived.** It closes the landing (404, same path as inactive), stops the link fan-out and hides the `/enlaces` CTA — but it deliberately does **not** touch `isActive`, which is Dayana's switch. Date-only editions close at 03:00 the next operational day, not `startsAt + 3h`, because `startsAt` is a noon anchor. The guard lives in the cron, not in the mailer lib, so **manual resends still work on a closed-but-unarchived edition**.
- Resend has three scopes: one person, everyone still pending, and everyone (OWNER-only, rate-limited, and hard-rejected unless the target is the live edition). `WebinarRegistration.lastSendError` is a denormalized copy of the last provider failure so the panel can filter failures without a join — the full attempt history stays in `NotificationDelivery`.
- **The promo video is Mux with a `public` playback policy** — unlike course recordings, which are `signed`. No token route, no JWT; `<MuxPlayer playbackId>` talks straight to Mux's CDN. It shares the LMS webhook (`/api/webhooks/mux`), which tries the class handler first and falls through to the webinar on `count === 0` (Mux ids are globally unique, so no need to read `passthrough`). `GET /api/admin/webinar/video` reconciles against the Mux API — the only way this is testable locally, since Mux can't reach `localhost`, and a self-heal for a dropped webhook in prod.

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
| `LEMONSQUEEZY_API_KEY` / `LEMONSQUEEZY_STORE_ID` / `LEMONSQUEEZY_WEBHOOK_SECRET` | Lemon Squeezy. All three required when `LEMONSQUEEZY_CHECKOUT_ENABLED=true` |
| `LEMONSQUEEZY_CHECKOUT_ENABLED` / `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_ENABLED` | Endpoint accepts / button renders. Server-on + public-off is the prod verification state |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe. Required only when `STRIPE_CHECKOUT_ENABLED=true`; `sk_test_` is rejected in prod |
| `STRIPE_CHECKOUT_ENABLED` / `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED` | Server accepts / button renders. Public one requires the server one |
| `NOTIFICATIONS_ENABLED` | `true` to actually send |
| `NOTIFICATIONS_DRY_RUN` | `true` to skip external calls — **defaults ON outside production** |
| `NOTIFICATIONS_STREAM_ENABLED` | `true` for SSE on the bell; unset falls back to 60s polling |
| `RESEND_WEBHOOK_SECRET` | Signs `/api/webhooks/resend` (bounce/complaint → auto-suppress `Contact.notifyEmail`) |
| `NOTIFICATIONS_PRUNE_DELIVERIES` | `true` to let the retention cron prune `NotificationDelivery` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | SMS. All three or none — the auth token also signs both Twilio webhooks |
| `TWILIO_MARKETING_FROM_NUMBER` | Optional second sender; campaigns (anything with a `campaignId`) go out from it, transactional never does |
| `TWILIO_WEBHOOK_BASE_URL` | Only if the public domain isn't `NEXT_PUBLIC_SITE_URL` — the signature covers the URL as configured in Twilio's console |
| `UPSTASH_REDIS_REST_URL/TOKEN` | Distributed rate limiting |
| `CRM_UI_PREVIEW` | `true` only in preview — disables auth for UI preview |
| `META_INBOX_ENABLED` | `true` to show `/admin/inbox` and accept its API routes |
| `META_APP_SECRET` | HMAC key for `X-Hub-Signature-256`; also the OAuth code exchange |
| `META_LOGIN_CONFIG_ID` | Facebook Login for Business config — replaces `scope` |
| `META_PAGE_ID` / `META_PAGE_ACCESS_TOKEN` | **Fallback** only; a linked account in the DB wins |
| `SOCIAL_PUBLISHING_ENABLED` | `true` to show `/admin/contenido` |
| `TIKTOK_AUDITED` | `true` only after TikTok's audit — until then every post is forced `SELF_ONLY` |
| `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` | Mux API credentials — provisioned by `vercel integration add mux` |
| `MUX_WEBHOOK_SECRET` | Signs `/api/webhooks/mux`; created by hand in the Mux dashboard, not by the marketplace install |
| `MUX_SIGNING_KEY_ID` / `MUX_SIGNING_KEY_PRIVATE` | Signs playback JWTs for course recordings; separate credential pair from the API token, created by hand in the Mux dashboard |

Production env validated at startup via `lib/env.server.ts` (Zod schema, throws on missing vars).
