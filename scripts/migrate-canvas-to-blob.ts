/**
 * Backfill: mueve los dibujos del cuaderno clínico de Postgres (canvas_data)
 * a Vercel Blob y deja solo el puntero (canvas_url).
 * Uso: bun --env-file=.env run scripts/migrate-canvas-to-blob.ts
 *
 * Requiere BLOB_READ_WRITE_TOKEN (o vars OIDC) y DATABASE_URL.
 * Idempotente: solo procesa filas con canvas_data no nulo.
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

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { isBlobConfigured } from "../lib/storage/blob";
import { saveCanvasSceneToBlob } from "../lib/crm/notebook-canvas-blob";

const main = async () => {
  if (!isBlobConfigured()) {
    console.error(
      "Vercel Blob no está configurado (BLOB_READ_WRITE_TOKEN). Aborto."
    );
    process.exit(1);
  }

  const rows = await prisma.contactNotebookPage.findMany({
    where: { canvasData: { not: Prisma.AnyNull } },
    select: { id: true, contactId: true, canvasData: true, canvasUrl: true },
  });

  console.log(`Filas con canvas_data en Postgres: ${rows.length}`);

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const serialized = JSON.stringify(row.canvasData);
      const url = await saveCanvasSceneToBlob(row.contactId, row.id, serialized);
      await prisma.contactNotebookPage.update({
        where: { id: row.id },
        data: { canvasUrl: url, canvasData: Prisma.JsonNull },
      });
      ok += 1;
      console.log(`✓ ${row.id} → ${url}`);
    } catch (e) {
      failed += 1;
      console.error(`✗ ${row.id}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`Listo. Migradas: ${ok}, fallidas: ${failed}`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
};

void main();
