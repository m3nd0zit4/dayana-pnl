# Inngest (CRM Dayana)

Automatizaciones: post-pago, recordatorios de sesión, leads sin seguimiento.

## Variables

En `.env` (ver `.env.example`):

- `INNGEST_EVENT_KEY` — clave de eventos del dashboard Inngest
- `INNGEST_SIGNING_KEY` — firma del endpoint `/api/inngest`

Sin estas variables el endpoint sigue registrado pero los eventos desde `lib/inngest/events.ts` no se entregan en producción.

## Desarrollo local

1. Crea cuenta en [Inngest](https://www.inngest.com) y copia las claves al `.env`.
2. Arranca la app: `bun dev`
3. En otra terminal: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`

## Producción

Configura las mismas variables en Vercel y registra la URL `https://tu-dominio.com/api/inngest` en el dashboard Inngest.

## Funciones

Definidas en `lib/inngest/functions.ts` (lead stale, recordatorios, etc.).
