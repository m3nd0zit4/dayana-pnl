#!/usr/bin/env node
/**
 * Impide que vuelva la deriva de color en el CRM.
 *
 * Existe porque el contrato de Playwright no puede cazar esto: una clase
 * `text-[#b4543a]` renderiza perfectamente, pasa el typecheck, pasa el lint y
 * solo se nota cuando alguien cambia de tema o compara dos pantallas. La
 * página del webinar acumuló una decena de casos así sin que nada protestara.
 *
 * Lo que se busca son colores escritos a mano donde debería haber un token.
 * Si algo aquí resulta ser un falso positivo, la respuesta correcta casi nunca
 * es añadirlo a la lista de excepciones: es usar el token.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app/components/admin/crm", "app/components/miembros"];

/** Cada patrón dice qué se prohíbe y con qué se sustituye. */
const RULES = [
  {
    re: /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/g,
    fix: "usa un token (text-foreground, bg-card, border-border…)",
  },
  {
    re: /\b(?:text|bg|border)-(?:black|white)\/\d+/g,
    fix: "usa foreground/background con opacidad de token",
  },
  {
    re: /\b(?:text|bg|border|ring)-(?:emerald|green)-\d{2,3}/g,
    fix: "usa --success (text-success, bg-success/10)",
  },
  {
    re: /\b(?:text|bg|border|ring)-(?:amber|yellow|orange)-\d{2,3}/g,
    fix: "usa --warning (text-warning, bg-warning/10)",
  },
  {
    re: /\b(?:text|bg|border|ring)-(?:red|rose)-\d{2,3}/g,
    fix: "usa --destructive",
  },
  {
    re: /\b(?:text|bg|border|ring)-(?:violet|purple|indigo|blue|cyan|teal|pink|fuchsia|lime|neutral|zinc|slate|gray|stone)-\d{2,3}/g,
    fix: "fuera de la paleta — ver DESIGN.md",
  },
];

/**
 * Excepciones, con motivo. Cada entrada es deuda consciente, no permiso
 * general: se apunta el archivo entero solo cuando el color es de una marca
 * ajena y cambiarlo sería incorrecto, no incómodo.
 */
const ALLOW = new Map([
  [
    "app/components/admin/crm/CrmLogo.tsx",
    "identidad de marca, fija en ambos temas",
  ],
]);

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
};

const findings = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative(process.cwd(), file).replace(/\\/g, "/");
    if (ALLOW.has(rel)) continue;

    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const { re, fix } of RULES) {
        for (const match of line.matchAll(re)) {
          findings.push({ rel, line: i + 1, token: match[0], fix });
        }
      }
    });
  }
}

/**
 * Trinquete, no puerta cerrada.
 *
 * El barrido inicial encontró 144 casos, de los cuales 35 estaban en pantallas
 * que ya se habían migrado y se arreglaron. Los 109 restantes son deuda previa
 * repartida sobre todo por el panel del agente, la bandeja de entrada y el
 * portal — arreglarlos requiere tocar pantallas que hoy no tienen cobertura
 * automática, así que no se hace de paso.
 *
 * Poner el listón en el número actual convierte esto en algo útil desde ya:
 * nadie puede añadir un color nuevo. Y este número **solo puede bajar**. Si
 * arreglas casos, baja también la constante en el mismo commit; si sube,
 * significa que has introducido deriva nueva.
 */
const BASELINE = 94;

if (findings.length > BASELINE) {
  console.error(
    `check-crm-tokens: ${findings.length} colores fuera de paleta, ` +
      `por encima de la línea base de ${BASELINE}.\n` +
      `Se han añadido ${findings.length - BASELINE} nuevos.\n`,
  );
  for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  ${f.token}  →  ${f.fix}`);
  }
  process.exit(1);
}

if (findings.length < BASELINE) {
  console.log(
    `check-crm-tokens: ${findings.length} colores fuera de paleta ` +
      `(línea base ${BASELINE}).\n` +
      `Han bajado ${BASELINE - findings.length}: baja BASELINE a ${findings.length} ` +
      `en scripts/check-crm-tokens.mjs para fijar la mejora.`,
  );
  process.exit(0);
}

console.log(
  `check-crm-tokens: ${findings.length} colores fuera de paleta, ` +
    `igual que la línea base. Sin deriva nueva.`,
);
process.exit(0);
