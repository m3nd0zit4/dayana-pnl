import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import MemberAuthShell from "@/app/components/miembros/MemberAuthShell";
import { getStaffSession } from "@/lib/auth/staff-session";
import { checkAuthorizationRequest, offeredScopes } from "@/lib/mcp/oauth";
import { describeRedirect } from "@/lib/mcp/oauth-format";
import { publicOrigin } from "@/lib/mcp/oauth-http";
import { MCP_SCOPES, roleScopes, SCOPE_LABELS } from "@/lib/mcp/scopes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Autorizar conexión — CRM",
  robots: { index: false, follow: false },
};

/**
 * Pantalla de consentimiento del OAuth del MCP (el `authorization_endpoint`).
 * Llega aquí quien pulsa «Conectar» en claude.ai u otro cliente; el proxy ya
 * le pidió iniciar sesión con su cuenta del CRM. Elige qué permisos da (nunca
 * más que su rol) y vuelve al cliente con el código. Ver docs/mcp.md.
 */

/** Los parámetros OAuth que viajan del GET al POST del consentimiento. */
const FORWARDED = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
  "resource",
] as const;

const textClass = "font-[font1] text-[13px] leading-relaxed text-foreground/70";

const Problem = ({ message }: { message: string }) => (
  <MemberAuthShell title="No se puede conectar" description="Vuelve a la aplicación e inténtalo de nuevo.">
    <p className={textClass} role="alert">
      {message}
    </p>
  </MemberAuthShell>
);

const Page = async ({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) => {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = raw[key];
    if (typeof value === "string") params.set(key, value);
  }

  const staff = await getStaffSession();
  if (!staff) redirect(`/acceso?callbackUrl=${encodeURIComponent(`/admin/autorizar-mcp?${params.toString()}`)}`);

  const origin = publicOrigin(await headers());
  const check = await checkAuthorizationRequest(params, origin);
  if (check.kind === "fatal") return <Problem message={check.message} />;
  if (check.kind === "redirect") redirect(check.url);

  const { client, request } = check;
  const destination = describeRedirect(request.redirectUri);
  const allowed = roleScopes(staff.role);
  const offered = offeredScopes(request, staff.role);
  const appName = destination.known && client.name.toLowerCase().includes(destination.known.toLowerCase()) ? destination.known : client.name;

  return (
    <MemberAuthShell
      title="Conectar con el CRM"
      description={`${appName} quiere usar el CRM en tu nombre, ${staff.displayName}.`}
    >
      <form method="post" action="/api/admin/mcp-oauth/authorize" className="space-y-5">
        {FORWARDED.map((key) => {
          const value = params.get(key);
          return value === null ? null : <input key={key} type="hidden" name={key} value={value} />;
        })}

        <div className="space-y-1.5">
          <p className={textClass}>
            <strong className="text-foreground">{client.name}</strong>
            {destination.known ? (
              <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground/60">
                Dirección de {destination.known} reconocida
              </span>
            ) : null}
          </p>
          <p className={textClass}>
            Al aceptar, vuelves a <strong className="text-foreground">{destination.label}</strong>.
            {!destination.known && !destination.local ? (
              <span className="block text-destructive">
                No reconocemos esta dirección. Acepta solo si acabas de pedir esta conexión desde ahí.
              </span>
            ) : null}
          </p>
        </div>

        {offered.length === 0 ? (
          <p className={textClass} role="alert">
            {allowed.length === 0
              ? "Tu rol no tiene acceso al CRM por MCP."
              : "La aplicación pidió permisos que tu rol no tiene."}
          </p>
        ) : (
          <fieldset className="space-y-3">
            <legend className="mb-2 font-[font2] text-[11px] uppercase tracking-[0.2em] text-foreground/55">Permisos</legend>
            {MCP_SCOPES.map((scope) => {
              const enabled = offered.includes(scope);
              return (
                <label key={scope} className={`flex items-start gap-3 ${enabled ? "" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    name="grant_scope"
                    value={scope}
                    defaultChecked={enabled}
                    disabled={!enabled}
                    className="mt-1 size-4 accent-current"
                  />
                  <span className={textClass}>
                    <strong className="text-foreground">{SCOPE_LABELS[scope].label}</strong> — {SCOPE_LABELS[scope].description}
                    {!allowed.includes(scope) ? " (tu rol no lo permite)" : !enabled ? " (no lo pidió)" : ""}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        <p className="font-[font1] text-[12px] leading-relaxed text-foreground/50">
          Todo lo que cambie queda en el registro de auditoría con tu nombre. Puedes cortar la conexión cuando quieras
          en Ajustes → Conexiones MCP.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          {offered.length > 0 ? (
            <button
              type="submit"
              name="decision"
              value="approve"
              className="w-full rounded-xl bg-linen py-3.5 font-[font2] text-xs uppercase tracking-[0.25em] text-black transition-colors hover:bg-white"
            >
              Permitir
            </button>
          ) : null}
          <button
            type="submit"
            name="decision"
            value="deny"
            className="w-full rounded-xl border border-border py-3.5 font-[font2] text-xs uppercase tracking-[0.25em] text-foreground/70 transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
        </div>
      </form>
    </MemberAuthShell>
  );
};

export default Page;
