import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { readPendingDiagnostics } from "@/lib/crm/diagnostic-outreach";

export const dynamic = "force-dynamic";
// Cuatro lecturas de la IA por llamada; la página repite hasta terminar.
export const maxDuration = 120;

/** Cuántas autoevaluaciones completas no tienen lectura de la IA. */
export const GET = withStaff("read", async () =>
  NextResponse.json({
    pending: await prisma.diagnostic.count({
      where: { completedAt: { not: null }, contactId: { not: null }, aiAnalysis: { equals: Prisma.DbNull } },
    }),
  })
);

/** Lee la siguiente tanda. No le escribe a nadie: solo guarda la lectura. */
export const POST = withStaff("write", async () => NextResponse.json(await readPendingDiagnostics(4)));
