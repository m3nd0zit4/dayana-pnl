# Deploy a producción — Dayana PNL

Pasos manuales en dashboards (el código valida env al arrancar en Vercel Production).

## Orden recomendado

### 1. Neon PostgreSQL

- `DATABASE_URL` → host **pooler**, `?pgbouncer=true&connection_limit=1`
- `DIRECT_URL` → host **directo**, puerto 5432
- Añade **ambas** en Vercel → Environment Variables → **Production** y marca **Build** para `DIRECT_URL`

### 2. Vercel — env vars Production

Pega todas las variables de [`docs/proximos-pasos.md`](proximos-pasos.md) §1.

Genera `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 3. PayPal Live

1. [developer.paypal.com](https://developer.paypal.com) → App **Live**
2. `PAYPAL_MODE=live`
3. Webhook → `https://dayanabeltran.com/api/webhooks/paypal`
4. Copia `PAYPAL_WEBHOOK_ID`

### 4. Mercado Pago Live

1. [developers.mercadopago.com](https://www.mercadopago.com.co/developers/panel/credentials) → credenciales producción
2. Webhook → `https://dayanabeltran.com/api/webhooks/mercadopago`
3. Copia `MERCADOPAGO_WEBHOOK_SECRET`

### 5. Inngest

1. [inngest.com](https://www.inngest.com) → Create app
2. Sync URL: `https://dayanabeltran.com/api/inngest`
3. Copia `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` a Vercel

### 6. Upstash Redis

1. [console.upstash.com](https://console.upstash.com) → Redis database
2. REST API → `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

### 7. Vercel Blob

Dashboard → Storage → conectar store **Private** (`dayana-pnl-blob`) al proyecto → **Redeploy**

> El cuaderno clínico usa `access: 'private'`. Si el store es público, crea uno privado y reconecta el proyecto.

### 8. Seed (una vez)

Con `DIRECT_URL` de producción en tu `.env` local (o CI secret):

```bash
STAFF_OWNER_EMAIL=contacto@dayanabeltran.com
STAFF_OWNER_PASSWORD=<contraseña fuerte>
STAFF_OWNER_NAME="Dayana Beltrán"
bun run db:seed
```

### 9. Merge a `main`

Vercel despliega automáticamente. El build ejecuta:

```
prisma generate && prisma migrate deploy && next build
```

### 10. Verificación post-deploy

- `/` carga planes desde DB
- Pago PayPal + MP de prueba
- Login `/admin/sign-in`
- Subida en cuaderno clínico

## Si el deploy falla por env

Revisa logs de Vercel. Mensajes `[env] Production environment validation failed` indican variable faltante o incorrecta.

## Preview deployments

Preview no exige todas las env vars de producción, pero webhooks **requieren** secrets (no hay bypass fuera de `NODE_ENV=development` local).
