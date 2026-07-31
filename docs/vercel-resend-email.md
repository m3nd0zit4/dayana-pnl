# Correo con dominio en Vercel + Resend

Dominio del sitio: **dayanabeltran.com**  
Remitente recomendado: **contacto@dayanabeltran.com**

No necesitas Google Workspace. Resend envía correo transaccional tras verificar el dominio en DNS.

## 1. Resend

1. Cuenta en [resend.com](https://resend.com).
2. **API Keys** → Create → copia `re_...` a `.env` y Vercel:

   ```env
   RESEND_API_KEY=re_xxxxxxxx
   ```

3. **Domains** → Add domain → `dayanabeltran.com`.

## 2. DNS (dominio comprado en Vercel)

1. [Vercel Dashboard](https://vercel.com) → tu proyecto → **Settings** → **Domains** (o el equipo → Domains).
2. Abre **dayanabeltran.com** → DNS / DNS Records.
3. Resend te muestra registros (SPF, DKIM, a veces un TXT de verificación). **Cópialos tal cual** en Vercel.
4. En Resend, espera estado **Verified** (puede tardar unos minutos).

## 2.1 DMARC (para que no caiga en spam)

Resend solo pide SPF + DKIM, pero sin DMARC muchos proveedores (Gmail, Yahoo)
desconfían del dominio y mandan el correo a spam. Añade este registro junto a
los de SPF/DKIM, en el mismo panel de DNS:

| Tipo | Nombre | Valor |
|------|--------|-------|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:contacto@dayanabeltran.com; fo=1` |

`p=none` es modo monitoreo: no bloquea nada, solo empieza a mandar reportes
agregados al correo indicado. Una vez que los reportes se vean limpios (unas
semanas), se puede subir a `p=quarantine`.

## 2.2 Webhook de rebotes/spam (opcional pero recomendado)

Sin esto, un correo que rebota o que el destinatario marca como spam se sigue
mandando indefinidamente — daña la reputación del dominio con el tiempo. Para
que se desactiven solas las notificaciones de ese contacto:

1. Resend Dashboard → **Webhooks** → **Add Endpoint**.
2. URL: `https://<tu-dominio-en-vercel>/api/webhooks/resend`.
3. Eventos a marcar: `email.bounced`, `email.complained`.
4. Copia el **Signing Secret** (`whsec_...`) a `.env` y Vercel:

   ```env
   RESEND_WEBHOOK_SECRET=whsec_...
   ```

## 3. Variables en `.env` y producción (Vercel)

```env
NOTIFICATIONS_ENABLED=true
NOTIFICATIONS_DRY_RUN=false
NOTIFICATIONS_EMAIL_FROM=contacto@dayanabeltran.com
NOTIFICATIONS_EMAIL_FROM_NAME=Dayana Beltrán PNL
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...   # opcional, ver 2.2

# Deja SMTP vacío si solo usas Resend
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
```

En Vercel: **Project → Settings → Environment Variables** → mismas claves en Production (y Preview si quieres probar ahí).

## 4. Probar envío

```bash
bunx tsx scripts/send-example-email.ts julianestebanmb2007@gmail.com
```

O en el CRM: **Notificaciones** → redactar → **Enviarme este correo** (llega al email del staff; para otro destino usa el script).

## 5. Staff / login CRM

Opcional: alinear el usuario OWNER con el mismo correo:

```env
STAFF_OWNER_EMAIL=contacto@dayanabeltran.com
```

Luego `bun run db:seed` o actualizar en la base si ya existe otro email.
