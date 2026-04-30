import type { APIRoute } from "astro";
import { RequestError } from "@octokit/request-error";
import { Buffer } from "node:buffer";
import * as cheerio from "cheerio";
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

function toAbsoluteUrlOrNull(input: string): string | null {
  const v = (input || "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
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
  sourceUrl?: string;
  articleHtml?: string;
};

type DownloadedImage = {
  buf: Buffer;
  ext: string;
  contentType: string;
  sourceUrl: string;
};

const SUPPORTED_IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
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

function inferImageExt(contentType: string, buf: Buffer): string | null {
  const mime = (contentType || "").toLowerCase().split(";")[0].trim();
  if (mime && SUPPORTED_IMAGE_MIME_TO_EXT[mime]) return SUPPORTED_IMAGE_MIME_TO_EXT[mime];
  if (mime.startsWith("image/")) {
    const subtype = mime.slice("image/".length).trim();
    if (subtype === "jpeg") return "jpg";
    if (subtype === "svg+xml") return "svg";
    if (/^[a-z0-9.+-]+$/i.test(subtype)) return subtype.replace(/\+/g, "-");
  }
  const byBytes = detectImageKindFromBuffer(buf);
  return byBytes?.ext || null;
}

async function fetchImageForImport(url: string): Promise<DownloadedImage | null> {
  try {
    const r = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      console.warn("[import-media] Falha ao baixar imagem da origem", {
        url,
        status: r.status,
        statusText: r.statusText,
      });
      return null;
    }
    const contentType = (r.headers.get("content-type") || "").toLowerCase().trim();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_HERO_IMAGE_BYTES) {
      console.warn("[import-media] Imagem inválida por tamanho", { url, bytes: buf.length });
      return null;
    }
    const ext = inferImageExt(contentType, buf);
    if (!ext) {
      console.warn("[import-media] Formato de imagem não suportado", { url, contentType });
      return null;
    }
    return { buf, ext, contentType, sourceUrl: url };
  } catch (e) {
    console.warn("[import-media] Erro no download da imagem", {
      url,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function uploadFeaturedToGithub(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slugBase: string,
  img: DownloadedImage,
): Promise<string | null> {
  const fileBase = `${slugifyFileName(slugBase)}-destaque`;
  const fileName = `${fileBase}.${img.ext}`;
  const repoPath = `public/assets/blog/${fileName}`;
  const heroImage = `/assets/blog/${fileName}`;
  const message = `content(assets): imagem destacada ${fileName}`;
  try {
    await publisher.createOrUpdateFileBytes(owner, repo, repoPath, img.buf, message, { branch });
    return heroImage;
  } catch (e) {
    console.warn("[import-media] Falha ao enviar imagem destacada para o GitHub", {
      repo: `${owner}/${repo}`,
      branch,
      repoPath,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function resolveMaybeAbsoluteImageUrl(rawUrl: string, sourceUrl?: string): string | null {
  const direct = toAbsoluteUrlOrNull(rawUrl);
  if (direct) return direct;
  const base = (sourceUrl || "").trim();
  if (!base) return null;
  try {
    const u = new URL(rawUrl, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function uploadToGithubStorage(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slugBase: string,
  index: number,
  img: DownloadedImage,
): Promise<string | null> {
  const safeSlug = slugifyFileName(slugBase);
  const fileName = `${safeSlug}-${index}.${img.ext}`;
  const repoPath = `public/assets/blog/${fileName}`;
  try {
    await publisher.createOrUpdateFileBytes(owner, repo, repoPath, img.buf, `content(assets): imagem ${fileName}`, { branch });
  } catch (e) {
    console.warn("[import-media] Falha ao enviar imagem do corpo para o GitHub", {
      sourceUrl: img.sourceUrl,
      repo: `${owner}/${repo}`,
      branch,
      repoPath,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
  return `/assets/blog/${fileName}`;
}

async function localizeMarkdownImages(params: {
  markdown: string;
  sourceUrl?: string;
  slugBase: string;
  publisher: GithubPublisher;
  owner: string;
  repo: string;
  branch: string;
}): Promise<string> {
  const { markdown, sourceUrl, slugBase, publisher, owner, repo, branch } = params;
  const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const matches = Array.from(markdown.matchAll(imageRegex));
  if (matches.length === 0) return markdown;

  const cache = new Map<string, string>();
  let imageIndex = 1;
  let output = markdown;

  for (const m of matches) {
    const full = m[0];
    const alt = m[1] || "";
    const raw = (m[2] || "").trim();
    const abs = resolveMaybeAbsoluteImageUrl(raw, sourceUrl);
    if (!abs) continue;
    let local = cache.get(abs);
    if (!local) {
      const img = await fetchImageForImport(abs);
      if (!img) continue;
      local = await uploadToGithubStorage(publisher, owner, repo, branch, slugBase, imageIndex, img);
      if (!local) continue;
      cache.set(abs, local);
      imageIndex += 1;
    }
    const escapedFull = full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(escapedFull, "g"), `![${alt}](${local})`);
  }
  return output;
}

function collectImageRefsFromMarkdown(markdown: string, sourceUrl?: string): Array<{ raw: string; abs: string }> {
  const imageRegex = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const out: Array<{ raw: string; abs: string }> = [];
  for (const m of markdown.matchAll(imageRegex)) {
    const raw = (m[1] || "").trim();
    const abs = resolveMaybeAbsoluteImageUrl(raw, sourceUrl);
    if (raw && abs) out.push({ raw, abs });
  }
  return out;
}

function extractOgOrTwitterImage(articleHtml?: string, sourceUrl?: string): string | null {
  const html = (articleHtml || "").trim();
  if (!html) return null;
  try {
    const $ = cheerio.load(html, { decodeEntities: true });
    const og = $('meta[property="og:image"]').attr("content")?.trim();
    const tw = $('meta[name="twitter:image"]').attr("content")?.trim();
    return resolveMaybeAbsoluteImageUrl(og || tw || "", sourceUrl);
  } catch {
    return null;
  }
}

async function processArticleAssets(params: {
  markdown: string;
  articleHtml?: string;
  sourceUrl?: string;
  featuredImageUrl?: string;
  slugBase: string;
  publisher: GithubPublisher;
  owner: string;
  repo: string;
  branch: string;
}): Promise<{ markdown: string; featuredPath: string; warnings: string[] }> {
  const { markdown, articleHtml, sourceUrl, featuredImageUrl, slugBase, publisher, owner, repo, branch } = params;
  const warnings: string[] = [];
  let processedMarkdown = markdown;

  // 1) Coleta URLs (corpo + destaque) e processa em concorrência.
  const markdownRefs = collectImageRefsFromMarkdown(markdown, sourceUrl);
  const ogOrTw = extractOgOrTwitterImage(articleHtml, sourceUrl);
  const featuredCandidate = ogOrTw || resolveMaybeAbsoluteImageUrl(featuredImageUrl || "", sourceUrl);
  const allAssetUrls = Array.from(
    new Set([
      ...markdownRefs.map((r) => r.abs),
      ...(featuredCandidate ? [featuredCandidate] : []),
    ]),
  );
  const indexByUrl = new Map<string, number>(allAssetUrls.map((u, i) => [u, i + 1]));

  const uploadedByUrl = new Map<string, string>();
  const downloadTasks = allAssetUrls.map(async (assetUrl) => {
    const img = await fetchImageForImport(assetUrl);
    if (!img) {
      warnings.push(`<!-- Falha ao importar imagem: ${assetUrl} -->`);
      return;
    }
    const idx = indexByUrl.get(assetUrl) || 1;
    const local = await uploadToGithubStorage(publisher, owner, repo, branch, slugBase, idx, img);
    if (!local) {
      // Não troca links quando upload falha.
      warnings.push(`<!-- Falha ao importar imagem: ${assetUrl} -->`);
      return;
    }
    uploadedByUrl.set(assetUrl, local);
  });
  await Promise.all(downloadTasks);

  // 2) Reescreve Markdown apenas para assets confirmados no GitHub.
  for (const ref of markdownRefs) {
    const local = uploadedByUrl.get(ref.abs);
    if (!local) continue;
    const escapedRaw = ref.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    processedMarkdown = processedMarkdown.replace(new RegExp(`(!\\[[^\\]]*\\]\\()${escapedRaw}(\\))`, "g"), `$1${local}$2`);
  }

  // 3) Determina destaque com prioridade og/twitter -> featured explícito -> primeira imagem local -> fallback obrigatório.
  let featuredPath = "/assets/blog/destaque.jpg";
  if (featuredCandidate) {
    const localFeatured = uploadedByUrl.get(featuredCandidate);
    if (localFeatured) {
      featuredPath = localFeatured;
    } else {
      // Tenta rota dedicada de destaque (nome semântico) se o asset foi baixado mas upload numerado não foi usado.
      const img = await fetchImageForImport(featuredCandidate);
      if (img) {
        const uploadedFeatured = await uploadFeaturedToGithub(publisher, owner, repo, branch, slugBase, img);
        if (uploadedFeatured) featuredPath = uploadedFeatured;
      }
    }
  }

  if (featuredPath === "/assets/blog/destaque.jpg") {
    const firstLocalMdImage = processedMarkdown.match(/!\[[^\]]*]\((\/assets\/blog\/[^)\s]+)\)/)?.[1];
    if (firstLocalMdImage) featuredPath = firstLocalMdImage;
  }

  if (warnings.length > 0) {
    processedMarkdown = `${processedMarkdown.trim()}\n\n${warnings.join("\n")}\n`;
  }

  return { markdown: processedMarkdown, featuredPath, warnings };
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

    try {
      const title = (p.title || "").trim() || slugIn;
      const description = (p.description || title).trim().slice(0, 160);
      const pubDate = (p.pubDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
      const markdownBodyRaw = typeof p.markdownBody === "string" ? p.markdownBody : "";
      const processedAssets = await processArticleAssets({
        markdown: markdownBodyRaw,
        articleHtml: p.articleHtml,
        sourceUrl: p.sourceUrl,
        featuredImageUrl: p.featuredImageUrl,
        slugBase: slugIn,
        publisher,
        owner,
        repo,
        branch,
      });
      const markdownBody = processedAssets.markdown;
      const heroImage = processedAssets.featuredPath;

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
      // Compatibilidade: mantém `heroImage` (schema Astro) e adiciona alias `featured`.
      const textBase = serializeBlogMarkdown(markdownBody, data);
      const text = textBase.replace(/^heroImage:\s*([^\n]+)$/m, "heroImage: $1\nfeatured: $1");

      const target = allowDuplicates
        ? await uniqueBlogPath(publisher, owner, repo, branch, slugIn)
        : { path: `${CMS_PATHS.blog}/${slugIn}.md`, slug: slugIn };
      const { path, slug } = target;
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
