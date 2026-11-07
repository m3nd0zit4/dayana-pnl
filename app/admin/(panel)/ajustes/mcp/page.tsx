import { redirect } from "next/navigation";
import McpTokensClient from "@/app/components/admin/crm/settings/McpTokensClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { roleScopes } from "@/lib/mcp/scopes";
import { listMcpTokens } from "@/lib/mcp/tokens";
import { siteUrl } from "@/lib/notifications/config";

export const dynamic = "force-dynamic";

/**
 * Conexiones MCP: tokens personales para que agentes externos (Claude Code,
 * Claude Desktop, Cursor…) usen el CRM por `/api/mcp`. Cada persona gestiona
 * las suyas; el OWNER ve y revoca las de todo el equipo. Ver docs/mcp.md.
 */
const Page = async () => {
  if (isCrmUiPreview()) {
    return (
      <McpTokensClient
        initialTokens={[]}
        allowedScopes={[]}
        viewerId="preview"
        isOwner={false}
        endpoint={`${siteUrl()}/api/mcp`}
      />
    );
  }
  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");

  const tokens = await listMcpTokens({ id: staff.id, role: staff.role });
  return (
    <McpTokensClient
      initialTokens={tokens}
      allowedScopes={roleScopes(staff.role)}
      viewerId={staff.id}
      isOwner={staff.role === "OWNER"}
      endpoint={`${siteUrl()}/api/mcp`}
    />
  );
};

export default Page;
