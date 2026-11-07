/**
 * Entrada stdio del servidor MCP del CRM, SOLO para probar contra la base de
 * desarrollo (`neondb_dev`) desde Claude Code / Claude Desktop sin desplegar.
 * Mismas herramientas y mismos permisos que `/api/mcp`, pero sin token: actúa
 * como la persona del equipo de `CRM_MCP_STAFF_EMAIL` (tiene que estar activa)
 * con los scopes de su rol.
 *
 *   claude mcp add dayana-crm-dev -e CRM_MCP_STAFF_EMAIL=tu@correo -- \
 *     bun --env-file=../dayana-pnl/.env scripts/mcp/crm-stdio.ts
 *
 * No arranca si DATABASE_URL no es /neondb_dev. No hay forma de saltárselo.
 */

// stdout es el canal del protocolo: cualquier console.log de una librería lo
// rompería, así que todo lo que no sea MCP va a stderr.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname;
  } catch {
    return "";
  }
})();
if (dbName !== "/neondb_dev") {
  console.error("[crm-stdio] Solo contra neondb_dev. DATABASE_URL apunta a otra base: no arranco.");
  process.exit(1);
}

const email = process.env.CRM_MCP_STAFF_EMAIL?.trim().toLowerCase();
if (!email) {
  console.error("[crm-stdio] Falta CRM_MCP_STAFF_EMAIL (el correo de la persona del equipo como la que actúa).");
  process.exit(1);
}

const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
const { prisma } = await import("@/lib/db");
const { roleScopes } = await import("@/lib/mcp/scopes");
const { newCrmMcpServer } = await import("@/lib/mcp/server");

const staff = await prisma.staffUser.findUnique({
  where: { email },
  select: { id: true, displayName: true, role: true, isActive: true },
});
if (!staff || !staff.isActive) {
  console.error(`[crm-stdio] No hay ninguna persona activa del equipo con el correo ${email}.`);
  process.exit(1);
}
const scopes = roleScopes(staff.role);
if (scopes.length === 0) {
  console.error(`[crm-stdio] El rol ${staff.role} no tiene acceso por MCP.`);
  process.exit(1);
}

const caller = {
  tokenId: "stdio-local",
  tokenName: "stdio local (neondb_dev)",
  staffId: staff.id,
  staffName: staff.displayName,
  role: staff.role,
  scopes,
  expiresAt: null,
};

serveStdio(() => newCrmMcpServer(caller), {
  onerror: (error) => console.error("[crm-stdio]", error.message),
});
console.error(`[crm-stdio] Listo: ${staff.displayName} (${staff.role}, ${scopes.join("+")}) contra neondb_dev.`);
export {};
