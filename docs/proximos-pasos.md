# Próximos pasos — CRM Dayana Beltrán

Checklist completo antes de merge a `main` (deploy automático en Vercel Production).

## 1. Variables en Vercel (Production)

Copia desde `.env.example`. **Obligatorias en Production:**

| Variable | Notas |
|----------|-------|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `DATABASE_URL` | Pooler Neon + `pgbouncer=true` |
| `DIRECT_URL` | Conexión directa (Build **y** Runtime) |
| `NEXT_PUBLIC_SITE_URL` | `https://dayanabeltran.com` |
| `PAYPAL_MODE` | `live` |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | Credenciales Live |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Igual que `PAYPAL_CLIENT_ID` |
| `PAYPAL_MODE` | `live` en producción (el SDK del navegador usa este valor vía `/api/paypal/sdk-config`) |
| `PAYPAL_WEBHOOK_ID` | Webhook Live registrado |
| `MERCADOPAGO_ACCESS_TOKEN` | Token producción (no `TEST-`) |
| `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | Public key producción |
| `MERCADOPAGO_WEBHOOK_SECRET` | Webhook MP registrado |
| `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` | Ambas o ninguna |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Rate limit distribuido |
| `NOTIFICATIONS_ENABLED` | `true` |
| `NOTIFICATIONS_DRY_RUN` | `false` |
| `RESEND_API_KEY` | Dominio verificado |
| `NOTIFICATIONS_EMAIL_FROM` | `contacto@dayanabeltran.com` |

**Una vez (seed):** `STAFF_OWNER_EMAIL`, `STAFF_OWNER_PASSWORD`, `STAFF_OWNER_NAME`

**No usar:** `CRM_UI_PREVIEW=true` en Production.

**Blob:** store **Private** conectado al proyecto (OIDC automático). Redeploy tras conectar.

Local: `bun run env:pull` → `.env` (Vercel Preview). Ver [`docs/dev-environment.md`](dev-environment.md)

## 2. Webhooks (obligatorios en prod)

| Proveedor | URL |
|-----------|-----|
| Mercado Pago | `https://dayanabeltran.com/api/webhooks/mercadopago` |
| PayPal | `https://dayanabeltran.com/api/webhooks/paypal` |

Sin `MERCADOPAGO_WEBHOOK_SECRET`, el CRM **no** pasa a Activo tras pago MP.

## 3. Inngest

1. Cuenta [inngest.com](https://www.inngest.com) → claves en Vercel.
2. Registrar `https://dayanabeltran.com/api/inngest`.
3. Local: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`

Post-pago, recordatorios y campañas >10 contactos dependen de Inngest.

## 4. Base de datos

El build ejecuta `prisma migrate deploy` (requiere `DIRECT_URL` en Build env).

**Una vez tras primer deploy:**

```bash
bun run db:seed
```

Crea productos, plantillas, talleres y usuario OWNER.

## 5. Correo

- [x] Dominio `dayanabeltran.com` en Resend + DNS en Vercel.
- [ ] `bun run email:sample tu@correo.com` con env de prod
- [ ] Pago de prueba Live → correo automático al cliente vía Inngest

## 6. Smoke tests pre-merge

- [x] `npm run typecheck` (pasa)
- [ ] `npm run lint` (61 issues preexistentes; no bloquean el deploy si CI falla, conviene limpiar aparte)
- [ ] PayPal Live (monto bajo) → CRM Activo + email
- [ ] MP Live → webhook OK → CRM Activo + email
- [ ] `/admin/sign-in` con OWNER
- [ ] Cuaderno: subida PDF (Blob privado)
- [ ] Broadcast >10 contactos → cola Inngest

## 7. Operación diaria del CRM

1. **Contactos** — teléfono E.164 y email cuando exista.
2. **Mensajes rápidos** — textos para WhatsApp.
3. **Talleres** → aviso masivo por correo.
4. **Notificaciones** → **Enviarme este correo** antes de broadcast.
5. **Terapias** — agendar sesiones.
6. **Cuaderno clínico** — pestaña en ficha del contacto.

## 8. Más adelante

- WhatsApp Business API (`WHATSAPP_*`)
- SMS Twilio (`TWILIO_*`)

## Comandos útiles

```bash
bun run db:migrate:deploy
bun run db:seed
bun run email:sample
bun run env:pull
npm run typecheck
bun dev
```

Ver también: [`docs/security-crm.md`](security-crm.md) · [`docs/production-deploy.md`](production-deploy.md)
