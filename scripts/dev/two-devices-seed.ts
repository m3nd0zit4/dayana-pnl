/**
 * Three unread notifications for the dev OWNER, for the two-device test.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/dev/two-devices-seed.ts
 */
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";

if (new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname !== "/neondb_dev") {
  console.error("two-devices-seed: solo contra /neondb_dev.");
  process.exit(1);
}

for (const n of [1, 2, 3]) {
  await emitPlatformNotification({
    eventType: "SYSTEM_ALERT",
    title: `[prueba] Aviso de sincronización ${n}`,
    body: "Márcala como leída en un dispositivo y mira el otro.",
    staff: ["staff_dev_owner"],
  });
}
console.log("two-devices-seed: 3 avisos sin leer para el OWNER de dev.");
process.exit(0);
