/**
 * One-off: aplica los nuevos nombres "escalera" a los productos de terapia
 * existentes en la DB (title, sessionsLabel, sessionsCount desde lib/plans).
 * Uso: bun --env-file=.env run scripts/rename-therapy-products.ts
 *
 * No toca precios. La descripción (features) solo se actualiza si coincide
 * exactamente con el texto sembrado original — protege ediciones del CRM.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const loadEnv = () => {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
};
loadEnv();

import { prisma } from "../lib/db";
import { SEED_PLANS_BY_ID as PLANS } from "../prisma/seed-data";

const THERAPY_IDS: string[] = [
  "therapy-1",
  "therapy-3",
  "therapy-6",
  "therapy-12",
  "therapy-24",
];

/** Texto de features sembrado ANTES del renombre (para el guard de descripción). */
const OLD_SEEDED_DESCRIPTIONS: Record<string, string> = {
  "therapy-1": [
    "1 hora por sesión",
    "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
    "Reprogramación de 1 a 2 eventos",
  ].join("\n"),
  "therapy-3": [
    "1 hora por sesión",
    "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
    "Reprogramación de 1 a 2 eventos por sesión",
    "Semana 1: se realizan dos sesiones (ejemplo: martes y jueves)",
    "Semana 2: se realiza la tercera sesión (Inicio de semana)",
    "Duración total: 1 semana y media",
  ].join("\n"),
  "therapy-6": [
    "1 hora por sesión",
    "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
    "Reprogramación de 1 a 2 eventos por sesión",
    "Calendario: 2 sesiones por semana durante 3 semanas (6 terapias en total).",
    "Duración aproximada del paquete: 3 semanas.",
  ].join("\n"),
  "therapy-12": [
    "1 hora por sesión",
    "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
    "Reprogramación de 1 a 2 eventos por sesión",
    "Calendario: 2 sesiones por semana durante 6 semanas (12 terapias en total).",
    "Duración aproximada del proceso: 1 mes y 2 semanas.",
  ].join("\n"),
  "therapy-24": [
    "1 hora por sesión",
    "Modalidad: Seciones 1:1 en vivo por Google Meet (desde la comodidad de tu casa)",
    "Reprogramación de 1 a 2 eventos por sesión",
    "Calendario: 2 sesiones por semana durante 12 semanas (24 terapias en total).",
    "Duración aproximada del proceso: 2 meses y 2 semanas.",
  ].join("\n"),
};

const main = async () => {
  for (const id of THERAPY_IDS) {
    const plan = PLANS[id];
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      console.log(`— ${id}: no existe en DB, se omite (el fallback estático aplica)`);
      continue;
    }

    const updateDescription =
      product.description === OLD_SEEDED_DESCRIPTIONS[id] ||
      !product.description?.trim();

    await prisma.product.update({
      where: { id },
      data: {
        title: plan.title,
        sessionsLabel: plan.sessions,
        sessionsCount: plan.sessionsCount ?? null,
        ...(updateDescription
          ? { description: plan.features.join("\n") }
          : {}),
      },
    });

    console.log(
      `✓ ${id}: "${product.title}" → "${plan.title}" (${plan.sessions})` +
        (updateDescription
          ? " · descripción actualizada"
          : " · descripción editada en CRM — se conserva")
    );
  }

  await prisma.$disconnect();
  console.log("Listo.");
};

void main();
