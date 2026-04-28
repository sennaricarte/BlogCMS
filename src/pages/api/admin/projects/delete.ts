import type { APIRoute } from "astro";
import { parseOwnerRepo } from "../../../../lib/github-parse-repo";
import { removeProjectFromRegistry } from "../../../../lib/project-manager";

export const prerender = false;

function json(o: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: {
    id?: string;
    githubRepoFullName?: string;
    vercelProjectId?: string;
    vercelProjectName?: string;
    vercelTeamId?: string;
    deleteRemote?: boolean;
    githubToken?: string;
    vercelToken?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const remoteErrors: string[] = [];
  if (body.deleteRemote) {
    const ghToken = body.githubToken?.trim();
    const veToken = body.vercelToken?.trim();
    if (!ghToken || !veToken) {
      return json({ ok: false, error: "Para excluir no GitHub e Vercel, informe githubToken e vercelToken." }, 400);
    }

    if (body.githubRepoFullName?.trim()) {
      try {
        const { owner, repo } = parseOwnerRepo(body.githubRepoFullName);
        const ghRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "BlogCMS-Admin/1.0",
          },
        });
        if (!(ghRes.status === 204 || ghRes.status === 404)) {
          const txt = await ghRes.text().catch(() => "");
          remoteErrors.push(`GitHub: HTTP ${ghRes.status}${txt ? ` - ${txt.slice(0, 180)}` : ""}`);
        }
      } catch (e) {
        remoteErrors.push(`GitHub: ${e instanceof Error ? e.message : "falha ao excluir repositório"}`);
      }
    }

    const projectRef = body.vercelProjectId?.trim() || body.vercelProjectName?.trim();
    if (projectRef) {
      try {
        const qs = new URLSearchParams();
        if (body.vercelTeamId?.trim()) qs.set("teamId", body.vercelTeamId.trim());
        const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectRef)}${qs.toString() ? `?${qs.toString()}` : ""}`;
        const vr = await fetch(url, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${veToken}` },
        });
        if (!(vr.status === 200 || vr.status === 204 || vr.status === 404)) {
          const txt = await vr.text().catch(() => "");
          remoteErrors.push(`Vercel: HTTP ${vr.status}${txt ? ` - ${txt.slice(0, 180)}` : ""}`);
        }
      } catch (e) {
        remoteErrors.push(`Vercel: ${e instanceof Error ? e.message : "falha ao excluir projeto"}`);
      }
    }
  }

  try {
    const result = await removeProjectFromRegistry({
      id: body.id,
      githubRepoFullName: body.githubRepoFullName,
      vercelProjectId: body.vercelProjectId,
    });
    if (!result.removed) {
      return json({ ok: false, error: "Projeto não encontrado no registo." }, 404);
    }
    return json({
      ok: true,
      removed: true,
      total: result.projects.length,
      remoteDeleted: body.deleteRemote ? remoteErrors.length === 0 : undefined,
      remoteErrors: body.deleteRemote ? remoteErrors : undefined,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Falha ao remover projeto." }, 500);
  }
};
