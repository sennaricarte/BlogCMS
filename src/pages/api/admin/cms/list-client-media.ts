import type { APIRoute } from "astro";
import { RequestError } from "@octokit/request-error";
import { CMS_PATHS } from "../../../../lib/cms-paths";
import { GithubPublisher } from "../../../../lib/github-service";
import { parseOwnerRepo } from "../../../../lib/github-repo-content";
import { isImageFileName } from "../../../../lib/media-filename";

export const prerender = false;

type Body = {
  GITHUB_PERSONAL_TOKEN?: string;
  githubRepoFullName?: string;
  branch?: string;
};

function json(o: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const token = body.GITHUB_PERSONAL_TOKEN?.trim();
  if (!token) {
    return json({ ok: false, error: "Token GitHub em falta (GITHUB_PERSONAL_TOKEN)." }, 400);
  }
  if (!body.githubRepoFullName?.trim()) {
    return json({ ok: false, error: "Indica githubRepoFullName (dono/repositório)." }, 400);
  }

  const branch = (body.branch ?? "main").trim() || "main";
  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseOwnerRepo(body.githubRepoFullName!));
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Repositório inválido." },
      400,
    );
  }

  const publisher = new GithubPublisher({ token });
  const dir = CMS_PATHS.clientCmsPublicDir;

  try {
    const items = await publisher.listPath(owner, repo, dir, { branch });
    const files = items.filter((i) => i.type === "file" && isImageFileName(i.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return json({
      ok: true,
      items: files.map((f) => ({
        name: f.name,
        path: f.path,
        url: `/assets/cms/${f.name}`,
      })),
    });
  } catch (e) {
    if (e instanceof RequestError && e.status === 404) {
      return json({ ok: true, items: [] });
    }
    const msg = e instanceof Error ? e.message : "Erro ao listar no GitHub.";
    return json({ ok: false, error: msg }, 502);
  }
};
