import type { APIRoute } from "astro";
import { RequestError } from "@octokit/request-error";
import { Buffer } from "node:buffer";
import { serializeBlogMarkdown, type BlogFrontmatterInput } from "../../../../lib/cms-matter";
import { CMS_PATHS } from "../../../../lib/cms-paths";
import { GithubPublisher } from "../../../../lib/github-service";
import { parseOwnerRepo } from "../../../../lib/github-repo-content";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";
import { detectImageKindFromBuffer, MAX_HERO_IMAGE_BYTES } from "../../../../lib/validate-hero-image";

export const prerender = false;

function json(o: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(headers as object) },
  });
}

function slugifyFileName(s: string): string {
  const t = (s || "").trim();
  if (!t) return "artigo-importado";
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artigo-importado";
}

type ImportPost = {
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  markdownBody: string;
  author?: string;
  tags?: string[];
  category?: string;
  draft?: boolean;
  featuredImageUrl?: string;
};

async function blogPathExists(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slug: string,
): Promise<boolean> {
  const path = `${CMS_PATHS.blog}/${slug}.md`;
  try {
    await publisher.getFileText(owner, repo, path, { branch });
    return true;
  } catch (e) {
    if (e instanceof RequestError && e.status === 404) return false;
    throw e;
  }
}

async function fetchFeaturedBuffer(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "BlogCMS-Import/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_HERO_IMAGE_BYTES) return null;
    if (!detectImageKindFromBuffer(buf)) return null;
    return buf;
  } catch {
    return null;
  }
}

async function uploadFeaturedToGithub(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slugBase: string,
  buf: Buffer,
): Promise<string | null> {
  const kind = detectImageKindFromBuffer(buf);
  if (!kind) return null;
  const fileBase = `${slugifyFileName(slugBase)}-${Date.now().toString(36)}`;
  const fileName = `${fileBase}.${kind.ext}`;
  const repoPath = `src/assets/blog/${fileName}`;
  const heroImage = `../../assets/blog/${fileName}`;
  const message = `content(assets): imagem destacada ${fileName}`;
  try {
    await publisher.createOrUpdateFileBytes(owner, repo, repoPath, buf, message, { branch });
    return heroImage;
  } catch {
    return null;
  }
}

async function uniqueBlogPath(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  baseSlug: string,
): Promise<{ path: string; slug: string }> {
  const base = slugifyFileName(baseSlug);
  let n = 0;
  while (n < 40) {
    const slug = n === 0 ? base : `${base}-${n}`;
    const path = `${CMS_PATHS.blog}/${slug}.md`;
    try {
      await publisher.getFileText(owner, repo, path, { branch });
      n += 1;
    } catch (e) {
      if (e instanceof RequestError && e.status === 404) {
        return { path, slug };
      }
      throw e;
    }
  }
  const slug = `${base}-${Date.now().toString(36)}`;
  return { path: `${CMS_PATHS.blog}/${slug}.md`, slug };
}

export const POST: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) {
    return json({ ok: false, error: "Sessão em falta." }, 401, auth.responseHeaders);
  }

  let body: {
    GITHUB_PERSONAL_TOKEN?: string;
    githubRepoFullName?: string;
    branch?: string;
    allowDuplicates?: boolean;
    posts?: ImportPost[];
  };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400, auth.responseHeaders);
  }

  const token = body.GITHUB_PERSONAL_TOKEN?.trim();
  if (!token) {
    return json({ ok: false, error: "Token GitHub em falta." }, 400, auth.responseHeaders);
  }
  if (!body.githubRepoFullName?.trim()) {
    return json({ ok: false, error: "Indica o repositório (dono/repo)." }, 400, auth.responseHeaders);
  }
  if (!Array.isArray(body.posts) || body.posts.length === 0) {
    return json({ ok: false, error: "Lista `posts` vazia." }, 400, auth.responseHeaders);
  }

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseOwnerRepo(body.githubRepoFullName!));
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Repo inválido." }, 400, auth.responseHeaders);
  }

  const branch = (body.branch ?? "main").trim() || "main";
  const allowDuplicates = body.allowDuplicates === true;
  const publisher = new GithubPublisher({ token });

  const created: string[] = [];
  const errors: Array<{ slug: string; error: string }> = [];
  const skipped: Array<{ slug: string; reason: string }> = [];
  const seenInBatch = new Set<string>();

  for (const p of body.posts) {
    const slugIn = slugifyFileName(p.slug || p.title);
    if (seenInBatch.has(slugIn)) {
      skipped.push({ slug: slugIn, reason: "Duplicado no lote atual." });
      continue;
    }
    seenInBatch.add(slugIn);

    if (!allowDuplicates) {
      const exists = await blogPathExists(publisher, owner, repo, branch, slugIn);
      if (exists) {
        skipped.push({ slug: slugIn, reason: "Já existe no repositório." });
        continue;
      }
    }

    const title = (p.title || "").trim() || slugIn;
    const description = (p.description || title).trim().slice(0, 160);
    const pubDate = (p.pubDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const markdownBody = typeof p.markdownBody === "string" ? p.markdownBody : "";

    let heroImage = "../../assets/blog/hero-primeiro.svg";
    const featUrl = (p.featuredImageUrl || "").trim();
    if (featUrl) {
      const buf = await fetchFeaturedBuffer(featUrl);
      if (buf) {
        const localHero = await uploadFeaturedToGithub(publisher, owner, repo, branch, slugIn, buf);
        if (localHero) heroImage = localHero;
      }
    }

    const data: BlogFrontmatterInput = {
      title,
      description,
      pubDate,
      author: (p.author || "Importação CMS").trim() || "Importação CMS",
      heroImage,
      tags: Array.isArray(p.tags) ? p.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      category: p.category?.trim() || undefined,
      draft: p.draft !== false,
    };

    try {
      const target = allowDuplicates
        ? await uniqueBlogPath(publisher, owner, repo, branch, slugIn)
        : { path: `${CMS_PATHS.blog}/${slugIn}.md`, slug: slugIn };
      const { path, slug } = target;
      const text = serializeBlogMarkdown(markdownBody, data);
      await publisher.createOrUpdateFile(
        owner,
        repo,
        path,
        text,
        `content(blog): importar «${title}» (${slug})`,
        { branch },
      );
      created.push(slug);
    } catch (e) {
      errors.push({
        slug: slugIn,
        error: e instanceof Error ? e.message : "Erro desconhecido.",
      });
    }
  }

  return json(
    {
      ok: errors.length === 0,
      created,
      skipped,
      errors,
      message:
        created.length > 0
          ? `${created.length} artigo(s) criado(s) no ramo ${branch}.${skipped.length > 0 ? ` ${skipped.length} repetido(s) ignorado(s).` : ""}`
          : skipped.length > 0
            ? `Nenhum artigo novo criado. ${skipped.length} repetido(s) foram ignorado(s).`
            : "Nenhum artigo foi criado.",
    },
    errors.length === body.posts!.length ? 502 : 200,
    auth.responseHeaders,
  );
};
