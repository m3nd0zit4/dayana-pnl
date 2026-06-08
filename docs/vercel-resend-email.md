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

## 3. Variables en `.env` y producción (Vercel)

```env
NOTIFICATIONS_ENABLED=true
NOTIFICATIONS_DRY_RUN=false
NOTIFICATIONS_EMAIL_FROM=contacto@dayanabeltran.com
NOTIFICATIONS_EMAIL_FROM_NAME=Dayana Beltrán PNL
RESEND_API_KEY=re_...

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
