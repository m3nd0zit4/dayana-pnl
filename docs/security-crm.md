# Seguridad CRM — Dayana PNL

Guía operativa del panel staff (`/admin`).

## Autenticación

| Concepto | Valor |
|----------|-------|
| Ruta de login | `/admin/sign-in` |
| API Auth | `/api/auth/[...nextauth]` (NextAuth v5, credenciales) |
| Sign-up público | **No.** Solo OWNER crea usuarios en `/admin/team` |
| Duración de sesión | **30 días** por dispositivo |
| Cookie | `authjs.session-token` (dev) / `__Secure-authjs.session-token` (prod) |

### Variables obligatorias en producción

Validadas al arrancar (`lib/env.server.ts` + `instrumentation.ts`):

```env
AUTH_SECRET=                    # min 32 chars
DATABASE_URL=
DIRECT_URL=
NEXT_PUBLIC_SITE_URL=           # HTTPS, no localhost
MERCADOPAGO_WEBHOOK_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_MODE=live
INNGEST_EVENT_KEY=              # ambas claves Inngest
INNGEST_SIGNING_KEY=
UPSTASH_REDIS_REST_URL=          # rate limit distribuido
UPSTASH_REDIS_REST_TOKEN=
```

**Nunca** definir `CRM_UI_PREVIEW=true` en producción. En local, preview solo funciona **sin** `DATABASE_URL`.

### Rate limit de login

- 5 intentos fallidos por email / 15 min
- 20 intentos por IP / hora

## Pagos — integridad

- `assertEnrollmentPayable()` valida inscripción antes de cobrar (plan, estado, sin pago previo).
- PayPal capture valida monto vs precio del plan.
- Webhooks MP/PayPal: firma obligatoria fuera de desarrollo local; MP rechaza firmas >5 min.

## Sesiones activas

Las sesiones de staff se registran en base de datos (30 días, revocables al cerrar sesión).

Al desactivar un usuario (`isActive = false`), pierde acceso en el siguiente request.

## APIs admin

- Protegidas por `proxy.ts` + `resolveAdminStaff()` en cada handler
- Sin sesión: **401** `{ error: "UNAUTHORIZED" }`
- Mutaciones: verificación de `Origin`/`Referer` (CSRF básico)
- RBAC: OWNER / OPERATOR / DEVELOPER / READONLY

## Webhooks de pago

En producción y preview los webhooks **se rechazan** si faltan secretos (solo `NODE_ENV=development` local omite verificación).

## Rate limit distribuido

**Obligatorio en Production** (`UPSTASH_*`). Rutas públicas: leads, checkout, quote, pagos.

## Headers HTTP

Security headers en todas las rutas (`next.config.ts`). CSP en modo report-only.

## Cuaderno clínico

Subidas y miniaturas en Blob con **`access: private`**. Descarga vía API autenticada que hace proxy con `get()` (no URLs públicas directas).

**Producción:** Vercel Blob conectado (OIDC). Dibujo JSON en Postgres sin Blob.

## Runbook — cuenta comprometida

1. Desactivar usuario en `/admin/team`.
2. Revisar `/admin/audit`.
3. Rotar `AUTH_SECRET` como último recurso.
