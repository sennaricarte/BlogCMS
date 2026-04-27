import type { APIRoute } from "astro";
import type { BlogFrontmatterInput } from "../../../lib/cms-matter";
import { serializeBlogMarkdown } from "../../../lib/cms-matter";
import { GithubPublisher } from "../../../lib/github-service";
import { parseOwnerRepo } from "../../../lib/github-repo-content";

export const prerender = false;

type Body = {
  GITHUB_PERSONAL_TOKEN?: string;
  githubRepoFullName?: string;
  branch?: string;
  path?: string;
  sha?: string;
  message?: string;
  blog?: { data: BlogFrontmatterInput; body: string };
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

  const token = body.GITHUB_PERSONAL_TOKEN?.trim();
  if (!token) {
    return json({ ok: false, error: "Token GitHub em falta (GITHUB_PERSONAL_TOKEN)." }, 400);
  }

  if (!body.githubRepoFullName?.trim()) {
    return json({ ok: false, error: "Indica githubRepoFullName (dono/repositório)." }, 400);
  }

  if (!body.path?.trim()) {
    return json({ ok: false, error: "Caminho (path) do ficheiro em falta." }, 400);
  }

  if (!body.blog?.data || body.blog.body === undefined) {
    return json({ ok: false, error: "Objeto blog (data + body) em falta." }, 400);
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

  const d = { ...body.blog.data };
  d.description = (d.description || "").trim().slice(0, 160);
  d.title = (d.title || "").trim();
  d.author = (d.author || "Equipa").trim();
  d.heroImage = (d.heroImage || "../../assets/blog/hero-primeiro.svg").trim();
  d.tags = Array.isArray(d.tags) ? d.tags : [];
  d.draft = Boolean(d.draft);
  d.pubDate = d.pubDate?.trim() || new Date().toISOString().slice(0, 10);
  if (d.scheduled) {
    d.scheduled = true;
  } else {
    delete d.scheduled;
  }
  if (d.category?.trim()) d.category = d.category.trim();
  else delete d.category;

  const text = serializeBlogMarkdown(body.blog.body, d);
  const publisher = new GithubPublisher({ token });
  const message = (body.message || "").trim() || "content(blog): guardar (CMS)";

  try {
    const { content } = await publisher.createOrUpdateFile(
      owner,
      repo,
      body.path.trim(),
      text,
      message,
      { branch, sha: body.sha?.trim() || undefined },
    );
    return json({ ok: true, sha: content.sha, path: body.path.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao escrever no GitHub.";
    return json({ ok: false, error: msg }, 502);
  }
};
