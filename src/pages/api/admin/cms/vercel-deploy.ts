import type { APIRoute } from "astro";
import { parseOwnerRepo } from "../../../../lib/github-repo-content";
import { VercelApiError, VercelService } from "../../../../lib/vercel-service";

export const prerender = false;

type Body = {
  VERCEL_TOKEN?: string;
  VERCEL_TEAM_ID?: string;
  vercelProjectId: string;
  vercelProjectName: string;
  /** Para gitSource: org + repo */
  githubRepoFullName: string;
  ref?: string;
};

export const POST: APIRoute = async ({ request }) => {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON inválido." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const vToken = body.VERCEL_TOKEN?.trim();
  if (!vToken) {
    return new Response(JSON.stringify({ ok: false, error: "Vercel token em falta (VERCEL_TOKEN)." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const teamRaw = (body as { VERCEL_TEAM_ID?: string }).VERCEL_TEAM_ID?.trim();
  const projectId = body.vercelProjectId?.trim();
  const projectName = body.vercelProjectName?.trim();
  if (!projectId || !projectName) {
    return new Response(
      JSON.stringify({ ok: false, error: "vercelProjectId e vercelProjectName são obrigatórios." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseOwnerRepo(body.githubRepoFullName || ""));
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Repositório inválido." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const ref = (body.ref ?? "main").trim() || "main";
  const teamId = teamRaw ? teamRaw : null;

  try {
    const service = new VercelService({ token: vToken, teamId });
    const r = await service.triggerProductionDeployment(
      {
        vercelProjectId: projectId,
        projectName,
        owner,
        repo,
        ref,
        teamId: teamId ?? undefined,
      },
      {},
    );
    return new Response(
      JSON.stringify({
        ok: true,
        deploymentId: r.id,
        url: r.url,
        readyState: r.readyState,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof VercelApiError ? e.message : e instanceof Error ? e.message : "Falha no deploy.";
    const status = e instanceof VercelApiError && e.status >= 400 && e.status < 600 ? e.status : 502;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
};
