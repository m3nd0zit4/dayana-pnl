import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * «Avisar como mucho una vez al día» para una clave, de forma ATÓMICA.
 * Devuelve `true` sólo a la llamada que gana el día; las demás reciben `false`.
 *
 * Un «leer y luego escribir» no basta cuando las llamadas llegan en ráfaga: los
 * IPN de Mercado Pago llegan a la vez y cada uno lanza su propia comprobación,
 * así que todos leían el valor de ayer y todos avisaban. Aquí gana exactamente
 * uno: `create` choca con la clave única si ya hay fila, y si la hay se cambia
 * con una comparación sobre el valor EXACTO leído, que sólo casa para una
 * llamada concurrente.
 *
 * Un fallo de base de datos devuelve `false`: se prefiere no avisar a avisar de
 * más, y un aviso perdido aquí nunca es un cobro perdido.
 */
export const claimDailyAlert = async (
  key: string,
  now: Date = new Date()
): Promise<boolean> => {
  const day = now.toISOString().slice(0, 10);
  try {
    await prisma.siteSetting.create({ data: { key, value: day } });
    return true;
  } catch (e) {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    ) {
      console.error("[daily-alert-flag] no se pudo reclamar", key, e);
      return false;
    }
  }
  try {
    const row = await prisma.siteSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    if (!row || row.value === day) return false;
    const claimed = await prisma.siteSetting.updateMany({
      where: { key, value: row.value },
      data: { value: day },
    });
    return claimed.count === 1;
  } catch (e) {
    console.error("[daily-alert-flag] no se pudo renovar", key, e);
    return false;
  }
};
