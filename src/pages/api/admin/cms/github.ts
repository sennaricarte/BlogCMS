import type { APIRoute } from "astro";
import { RequestError } from "@octokit/request-error";
import {
  parseMarkdownFile,
  serializeBlogMarkdown,
  serializePageMarkdown,
  type BlogFrontmatterInput,
  type PageFrontmatterInput,
} from "../../../../lib/cms-matter";
import { CMS_PATHS } from "../../../../lib/cms-paths";
import { GithubPublisher } from "../../../../lib/github-service";
import { parseOwnerRepo } from "../../../../lib/github-repo-content";
import { isImageFileName } from "../../../../lib/media-filename";

export const prerender = false;

type Action =
  | "get"
  | "put"
  | "putBlog"
  | "putPage"
  | "delete"
  | "list"
  | "listBlog"
  | "listPages"
  | "listMedia";

type Body = {
  action?: Action;
  GITHUB_PERSONAL_TOKEN?: string;
  /** `owner/repo` */
  githubRepoFullName?: string;
  /** Ramo; predefinido: `main` */
  branch?: string;
  /** Caminho completo do ficheiro no repo, ex. `src/content/blog/post.md` */
  path?: string;
  content?: string;
  message?: string;
  /** Obrigatório para atualizar ou apagar ficheiro existente */
  sha?: string;
  /** Se true, com `get`, devolve `data` e `content` (markdown) em JSON. */
  parseFrontmatter?: boolean;
  blog?: { data: BlogFrontmatterInput; body: string };
  page?: { data: PageFrontmatterInput; body: string };
};

function json(/** @type {Record<string, unknown>} */ o: Record<string, unknown>, status = 200) {
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
  const branch = (body.branch ?? "main").trim() || "main";
  if (!token) {
    return json({ ok: false, error: "Token GitHub em falta (GITHUB_PERSONAL_TOKEN)." }, 400);
  }

  let owner: string;
  let repo: string;
  try {
    if (!body.githubRepoFullName?.trim()) {
      return json({ ok: false, error: "Indica githubRepoFullName (dono/repositório)." }, 400);
    }
    ({ owner, repo } = parseOwnerRepo(body.githubRepoFullName));
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Repositório inválido." },
      400,
    );
  }

  const publisher = new GithubPublisher({ token });
  const action = body.action ?? "get";

  try {
    if (action === "get") {
      if (!body.path?.trim()) return json({ ok: false, error: "Caminho (path) em falta." }, 400);
      const { text, sha } = await publisher.getFileText(owner, repo, body.path.trim(), { branch });
      if (body.parseFrontmatter) {
        const parsed = parseMarkdownFile(text);
        const d = { ...parsed.data } as Record<string, unknown>;
        for (const k of Object.keys(d)) {
          const v = d[k];
          if (v instanceof Date) d[k] = v.toISOString();
        }
        return json({
          ok: true,
          sha,
          path: body.path.trim(),
          data: d,
          content: parsed.content,
        });
      }
      return json({ ok: true, text, sha, path: body.path.trim() });
    }

    if (action === "put") {
      if (!body.path?.trim()) return json({ ok: false, error: "Caminho (path) em falta." }, 400);
      const text = body.content ?? "";
      const { commitSha, content } = await publisher.createOrUpdateFile(
        owner,
        repo,
        body.path.trim(),
        text,
        body.message?.trim() || "chore: atualizar conteúdo (CMS BlogCMS)",
        { branch, sha: body.sha },
      );
      return json({ ok: true, commitSha, sha: content.sha, path: body.path.trim() });
    }

    if (action === "putBlog") {
      if (!body.path?.trim()) return json({ ok: false, error: "Caminho (path) em falta." }, 400);
      if (!body.blog) return json({ ok: false, error: "Objeto `blog` em falta (data + body)." }, 400);
      const text = serializeBlogMarkdown(body.blog.body, body.blog.data);
      const { commitSha, content } = await publisher.createOrUpdateFile(
        owner,
        repo,
        body.path.trim(),
        text,
        body.message?.trim() || "chore(artigo): guardar (CMS BlogCMS)",
        { branch, sha: body.sha },
      );
      return json({ ok: true, commitSha, sha: content.sha, path: body.path.trim() });
    }

    if (action === "putPage") {
      if (!body.path?.trim()) return json({ ok: false, error: "Caminho (path) em falta." }, 400);
      if (!body.page) return json({ ok: false, error: "Objeto `page` em falta (data + body)." }, 400);
      const text = serializePageMarkdown(body.page.body, body.page.data);
      const { commitSha, content } = await publisher.createOrUpdateFile(
        owner,
        repo,
        body.path.trim(),
        text,
        body.message?.trim() || "chore(página): guardar (CMS BlogCMS)",
        { branch, sha: body.sha },
      );
      return json({ ok: true, commitSha, sha: content.sha, path: body.path.trim() });
    }

    if (action === "delete") {
      if (!body.path?.trim()) return json({ ok: false, error: "Caminho (path) em falta." }, 400);
      if (!body.sha?.trim()) return json({ ok: false, error: "SHA em falta (obrigatório para apagar)." }, 400);
      await publisher.deleteFile(
        owner,
        repo,
        body.path.trim(),
        body.message?.trim() || "chore: remover ficheiro (CMS)",
        body.sha.trim(),
        { branch },
      );
      return json({ ok: true, path: body.path.trim() });
    }

    if (action === "list") {
      if (!body.path?.trim()) return json({ ok: false, error: "Caminho (path) de pasta em falta." }, 400);
      const items = await publisher.listPath(owner, repo, body.path.trim(), { branch });
      return json({ ok: true, items });
    }

    if (action === "listBlog") {
      const list = await publisher.listPath(owner, repo, CMS_PATHS.blog, { branch });
      const mds = list.filter((i) => i.type === "file" && i.name.endsWith(".md"));
      const entries: Array<{
        slug: string;
        fileName: string;
        title: string;
        description: string;
        pubDate: string;
        draft: boolean;
        path: string;
        sha: string;
        category?: string;
        author: string;
        seoAlert: boolean;
      }> = [];
      const parseErrors: Array<{ file: string; error: string }> = [];

      for (const f of mds) {
        const p = `${CMS_PATHS.blog}/${f.name}`;
        try {
          const { text, sha } = await publisher.getFileText(owner, repo, p, { branch });
          const parsed = parseMarkdownFile(text);
          const d = parsed.data as Record<string, unknown>;
          const title = typeof d.title === "string" ? d.title : f.name;
          const description = typeof d.description === "string" ? d.description : "";
          let pubDate = "";
          const pd = d.pubDate;
          if (pd instanceof Date) pubDate = pd.toISOString();
          else if (typeof pd === "string") pubDate = new Date(pd).toISOString();
          const draft = Boolean(d.draft);
          const category = typeof d.category === "string" && d.category.trim() ? d.category.trim() : undefined;
          const author =
            typeof d.author === "string" && d.author.trim() ? d.author.trim() : "—";
          const hasDesc = typeof d.description === "string" && d.description.trim().length > 0;
          const hasHero = typeof d.heroImage === "string" && d.heroImage.trim().length > 0;
          const seoAlert = !hasDesc || !hasHero;
          entries.push({
            slug: f.name.replace(/\.md$/i, ""),
            fileName: f.name,
            title,
            description,
            pubDate: pubDate || new Date(0).toISOString(),
            draft,
            path: p,
            sha,
            category,
            author,
            seoAlert,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          parseErrors.push({ file: f.name, error: msg });
        }
      }

      entries.sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1));
      if (entries.length === 0 && parseErrors.length > 0) {
        return json({
          ok: false,
          error: parseErrors.map((p) => `${p.file}: ${p.error}`).join(" "),
          parseErrors,
        });
      }
      return json({
        ok: true,
        items: entries,
        ...(parseErrors.length ? { parseErrors } : {}),
      });
    }

    if (action === "listPages") {
      const list = await publisher.listPath(owner, repo, CMS_PATHS.pages, { branch });
      const mds = list.filter((i) => i.type === "file" && i.name.endsWith(".md"));
      const entries: Array<{
        slug: string;
        fileName: string;
        title: string;
        description: string;
        pubDate: string;
        draft: boolean;
        path: string;
        sha: string;
      }> = [];
      const parseErrors: Array<{ file: string; error: string }> = [];

      for (const f of mds) {
        const p = `${CMS_PATHS.pages}/${f.name}`;
        try {
          const { text, sha } = await publisher.getFileText(owner, repo, p, { branch });
          const parsed = parseMarkdownFile(text);
          const d = parsed.data as Record<string, unknown>;
          const title = typeof d.title === "string" ? d.title : f.name;
          const description = typeof d.description === "string" ? d.description : "";
          let pubDate = "";
          const pd = d.pubDate;
          if (pd instanceof Date) pubDate = pd.toISOString();
          else if (typeof pd === "string") pubDate = new Date(pd).toISOString();
          const draft = Boolean(d.draft);
          entries.push({
            slug: f.name.replace(/\.md$/i, ""),
            fileName: f.name,
            title,
            description,
            pubDate: pubDate || new Date(0).toISOString(),
            draft,
            path: p,
            sha,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          parseErrors.push({ file: f.name, error: msg });
        }
      }
      entries.sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1));
      if (entries.length === 0 && parseErrors.length > 0) {
        return json({
          ok: false,
          error: parseErrors.map((p) => `${p.file}: ${p.error}`).join(" "),
          parseErrors,
        });
      }
      return json({
        ok: true,
        items: entries,
        ...(parseErrors.length ? { parseErrors } : {}),
      });
    }

    if (action === "listMedia") {
      const mediaDir = "src/assets/media";
      try {
        const items = await publisher.listPath(owner, repo, mediaDir, { branch });
        const files = items.filter((i) => i.type === "file" && isImageFileName(i.name));
        return json({
          ok: true,
          items: files.map((f) => ({
            name: f.name,
            path: `${mediaDir}/${f.name}`,
            sha: f.sha,
          })),
        });
      } catch (e) {
        if (e instanceof RequestError && e.status === 404) {
          return json({ ok: true, items: [] });
        }
        throw e;
      }
    }

    return json({ ok: false, error: "Ação desconhecida." }, 400);
  } catch (e) {
    if (e instanceof RequestError && e.status === 404) {
      return json({ ok: false, error: "Ficheiro ou pasta não encontrada no repositório (404)." }, 404);
    }
    const msg = e instanceof Error ? e.message : "Erro desconhecido na API do GitHub.";
    return json({ ok: false, error: msg }, 502);
  }
};
