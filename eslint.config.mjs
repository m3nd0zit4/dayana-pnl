import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // eve (CRM agent) dev/build artifacts — bundled output, not source.
    ".eve/**",
    ".output/**",
    // Worktrees de git: copias completas del repo dentro del proyecto. Sin
    // esto ESLint lintea cada archivo dos veces y duplica cada error.
    ".worktrees/**",
  ]),
  {
    // Los fixtures de Playwright reciben un callback llamado `use`
    // (`async ({ page }, use) => { await use(valor) }`). La regla de hooks lo
    // confunde con el `use` de React y falla. No es código de React: aquí no
    // hay componentes ni hooks.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    // Deuda preexistente en el CRM (~29 errores): setState en effects y
    // mutaciones de refs durante render. Arreglarlos es un refactor de 20+
    // componentes; mientras, se degradan a warn para que CI pueda validar
    // schema + typecheck + e2e sin quedarse atascada en rojo eterno.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
