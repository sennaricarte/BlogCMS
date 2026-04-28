import type { APIRoute } from "astro";
import { fetchLatestDeploymentForProject, VercelApiError } from "../../../../lib/vercel-service";

export const prerender = false;

type Body = {
  VERCEL_TOKEN?: string;
  /** Equipa padrão (ex.: a das Definições). */
  VERCEL_TEAM_ID?: string;
  vercelProjectId: string;
  /** Equipa específica do projeto (sobrescreve a global). */
  projectTeamId?: string;
};

function json(o: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const token = body.VERCEL_TOKEN?.trim();
  if (!token) {
    return json({ ok: false, error: "Vercel token em falta (VERCEL_TOKEN)." }, 400);
  }

  const projectId = body.vercelProjectId?.trim();
  if (!projectId) {
    return json({ ok: false, error: "vercelProjectId em falta." }, 400);
  }

  const team =
    body.projectTeamId?.trim() || body.VERCEL_TEAM_ID?.trim() || null;

  try {
    const st = await fetchLatestDeploymentForProject(projectId, { token, teamId: team || undefined });
    if (!st) {
      return json({ ok: true, readyState: "UNKNOWN" });
    }
    return json({
      ok: true,
      readyState: st.readyState,
      deploymentUrl: st.url,
      readyDeploymentUrl: st.readyUrl,
    });
  } catch (e) {
    const msg = e instanceof VercelApiError ? e.message : e instanceof Error ? e.message : "Falha na Vercel.";
    const code = e instanceof VercelApiError && e.status === 404 ? 404 : 502;
    return json({ ok: false, error: msg }, code);
  }
};
