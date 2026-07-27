/**
 * Cambia el correo de una cuenta de staff.
 *
 * Uso:
 *   bun run scripts/set-staff-email.ts <correo-actual> <correo-nuevo>
 *
 * En producción, apuntando a la base de datos de Vercel Production:
 *   DATABASE_URL="<url-de-produccion>" bun run scripts/set-staff-email.ts a@x.com b@y.com
 *
 * Por qué existe: el correo de staff es también el usuario de inicio de sesión y
 * el destinatario de las notificaciones del equipo. Si apunta a un buzón que no
 * recibe, los avisos rebotan en silencio — Resend acepta el envío y el rebote
 * llega después, así que `NotificationDelivery` los registra como SENT.
 *
 * No toca la contraseña ni las sesiones activas.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const main = async () => {
  const [current, next] = process.argv.slice(2);
  if (!current || !next) {
    console.error("Uso: bun run scripts/set-staff-email.ts <actual> <nuevo>");
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) {
    console.error(`"${next}" no parece un correo válido.`);
    process.exit(1);
  }

  const staff = await prisma.staffUser.findUnique({
    where: { email: current },
    select: { id: true, displayName: true, role: true },
  });
  if (!staff) {
    console.error(`No hay ninguna cuenta de staff con el correo ${current}.`);
    process.exit(1);
  }

  const taken = await prisma.staffUser.findUnique({
    where: { email: next },
    select: { id: true },
  });
  if (taken && taken.id !== staff.id) {
    console.error(`Ya existe otra cuenta de staff con el correo ${next}.`);
    process.exit(1);
  }

  await prisma.staffUser.update({
    where: { id: staff.id },
    data: { email: next },
  });

  console.log(`${staff.displayName} (${staff.role}): ${current} → ${next}`);
  console.log("A partir de ahora inicia sesión con el correo nuevo.");
};

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
