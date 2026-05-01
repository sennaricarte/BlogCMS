import type { APIRoute } from "astro";
import { parseMarkdownFile, serializeBlogMarkdown, type BlogFrontmatterInput } from "../../../../lib/cms-matter";
import { CMS_PATHS } from "../../../../lib/cms-paths";
import {
  canonicalImageUrl,
  fetchImageForImport,
  normalizeLocalAssetPath,
  resolveMaybeAbsoluteImageUrl,
  slugifyImportFileBase,
  toAbsoluteUrlOrNull,
  uploadToGithubStorage,
} from "../../../../lib/github-import-media";
import { GithubPublisher } from "../../../../lib/github-service";
import { parseOwnerRepo } from "../../../../lib/github-repo-content";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";

export const prerender = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickAttrFromTagBlob(attrs: string, name: string): string {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attrs);
  if (quoted?.[2] != null) return quoted[2].trim();
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(attrs);
  return (unquoted?.[1] || "").trim();
}

function pickImgUrlFromTag(tag: string): string {
  const inner = tag.replace(/^<\s*img\b/i, "").replace(/\/?\s*>$/i, "");
  let raw =
    pickAttrFromTagBlob(inner, "src") ||
    pickAttrFromTagBlob(inner, "data-src") ||
    pickAttrFromTagBlob(inner, "data-lazy-src");
  if (!raw) {
    const ss = pickAttrFromTagBlob(inner, "srcset");
    if (ss) raw = ss.split(",")[0]?.trim().split(/\s+/)[0]?.trim() || "";
  }
  return raw;
}

/** URL absoluta https a migrar (Supabase, etc.); exclui caminhos já locais. */
function isExternalHttpAssetUrl(url: string): boolean {
  const t = url.trim().replace(/^["']|["']$/g, "");
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const h = new URL(t).hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local")) return false;
  } catch {
    return false;
  }
  return true;
}

function collectExternalImageUrlsFromBody(md: string): string[] {
  const found = new Set<string>();
  for (const m of (md || "").matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const raw = (m[1] || "").trim();
    const abs = resolveMaybeAbsoluteImageUrl(raw) || toAbsoluteUrlOrNull(raw);
    if (abs && isExternalHttpAssetUrl(abs)) found.add(canonicalImageUrl(abs));
  }
  for (const m of (md || "").matchAll(/<img\b[^>]*\/?>/gi)) {
    const raw = pickImgUrlFromTag(m[0]);
    if (!raw) continue;
    const abs = resolveMaybeAbsoluteImageUrl(raw) || toAbsoluteUrlOrNull(raw);
    if (abs && isExternalHttpAssetUrl(abs)) found.add(canonicalImageUrl(abs));
  }
  return [...found];
}

function replaceUrlsInText(text: string, urlMap: Map<string, string>): string {
  let out = text;
  const entries = [...urlMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [remote, local] of entries) {
    const variants = Array.from(new Set([remote, canonicalImageUrl(remote)]));
    for (const v of variants) {
      if (!v) continue;
      const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(esc, "g"), local);
    }
  }
  return out;
}

function parsedDataToBlogInput(data: Record<string, unknown>): BlogFrontmatterInput {
  const pubDate =
    data.pubDate instanceof Date
      ? data.pubDate.toISOString().slice(0, 10)
      : String(data.pubDate || new Date().toISOString()).slice(0, 10);
  const updatedDate =
    data.updatedDate instanceof Date
      ? data.updatedDate.toISOString().slice(0, 10)
      : typeof data.updatedDate === "string"
        ? data.updatedDate
        : undefined;
  return {
    title: String(data.title || "Sem título"),
    description: String(data.description || ""),
    seoTitle: typeof data.seoTitle === "string" ? data.seoTitle : undefined,
    seoFocusKeyword: typeof data.seoFocusKeyword === "string" ? data.seoFocusKeyword : undefined,
    pubDate,
    updatedDate,
    author: String(data.author || "Blog"),
    heroImage: String(data.heroImage ?? data.featured ?? ""),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    category: typeof data.category === "string" ? data.category : undefined,
    draft: Boolean(data.draft),
    scheduled: Boolean(data.scheduled),
  };
}

export const POST: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) {
    return new Response(JSON.stringify({ ok: false, error: "Sessão em falta." }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8", ...(auth.responseHeaders as object) },
    });
  }

  let body: { GITHUB_PERSONAL_TOKEN?: string; githubRepoFullName?: string; branch?: string; maxPosts?: number };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON inválido." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const token = body.GITHUB_PERSONAL_TOKEN?.trim();
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "Token GitHub em falta." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  if (!body.githubRepoFullName?.trim()) {
    return new Response(JSON.stringify({ ok: false, error: "Indica o repositório (dono/repo)." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseOwnerRepo(body.githubRepoFullName!));
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Repo inválido." }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  const branch = (body.branch ?? "main").trim() || "main";
  const maxPosts = Math.min(200, Math.max(1, Number(body.maxPosts) || 80));
  const publisher = new GithubPublisher({ token });

  const list = await publisher.listPath(owner, repo, CMS_PATHS.blog, { branch });
  const mds = list.filter((i) => i.type === "file" && i.name.endsWith(".md")).slice(0, maxPosts);

  let postsScanned = 0;
  let postsUpdated = 0;
  let imagesMigrated = 0;
  const errors: Array<{ path: string; error: string }> = [];

  for (const f of mds) {
    const path = `${CMS_PATHS.blog}/${f.name}`;
    postsScanned += 1;
    try {
      const { text, sha } = await publisher.getFileText(owner, repo, path, { branch });
      const parsed = parseMarkdownFile(text);
      const d = parsed.data as Record<string, unknown>;
      const slug = slugifyImportFileBase(f.name.replace(/\.md$/i, ""));

      const urlMap = new Map<string, string>();
      const bodyUrls = collectExternalImageUrlsFromBody(parsed.content);

      let heroCanon: string | null = null;
      const heroRaw = String(d.heroImage ?? d.featured ?? "").trim().replace(/^["']|["']$/g, "");
      if (heroRaw && isExternalHttpAssetUrl(heroRaw)) {
        heroCanon = canonicalImageUrl(
          resolveMaybeAbsoluteImageUrl(heroRaw) || toAbsoluteUrlOrNull(heroRaw) || heroRaw,
        );
      }

      const allRemote = new Set<string>([...bodyUrls, ...(heroCanon ? [heroCanon] : [])]);
      if (allRemote.size === 0) {
        await sleep(40);
        continue;
      }

      let attemptIdx = 0;
      for (const remoteUrl of allRemote) {
        if (urlMap.has(remoteUrl)) continue;
        attemptIdx += 1;
        const img = await fetchImageForImport(remoteUrl, null);
        if (!img) {
          errors.push({ path, error: `Falha ao descarregar: ${remoteUrl.slice(0, 96)}…` });
          continue;
        }
        const preferred = remoteUrl.split("/").filter(Boolean).pop()?.split("?")[0] || undefined;
        const local = await uploadToGithubStorage(
          publisher,
          owner,
          repo,
          branch,
          slug,
          attemptIdx,
          img,
          preferred,
        );
        if (!local) {
          errors.push({ path, error: `Falha ao enviar para o GitHub: ${remoteUrl.slice(0, 72)}…` });
          continue;
        }
        urlMap.set(remoteUrl, local);
        imagesMigrated += 1;
        await sleep(170);
      }

      if (urlMap.size === 0) {
        continue;
      }

      const newBody = replaceUrlsInText(parsed.content, urlMap);
      const blogInput = parsedDataToBlogInput(d);
      if (heroCanon && urlMap.has(heroCanon)) {
        blogInput.heroImage = normalizeLocalAssetPath(urlMap.get(heroCanon)!);
      }

      let out = serializeBlogMarkdown(newBody, blogInput);
      out = out.replace(/^heroImage:\s*([^\n]+)$/m, (_m, heroLine: string) => {
        const heroVal = String(heroLine || "").trim().replace(/^['"]|['"]$/g, "");
        const localHero = normalizeLocalAssetPath(heroVal);
        return `heroImage: "${localHero}"\nfeatured: "${localHero}"`;
      });

      if (out.trim() === text.trim()) {
        await sleep(80);
        continue;
      }

      await publisher.createOrUpdateFile(owner, repo, path, out, `content(blog): migrar imagens remotas (${slug})`, {
        branch,
        sha,
      });
      postsUpdated += 1;
      await sleep(200);
    } catch (e) {
      errors.push({ path, error: e instanceof Error ? e.message : "Erro desconhecido." });
    }
  }

  const ok = postsUpdated > 0 || (errors.length === 0 && postsScanned > 0);

  return new Response(
    JSON.stringify({
      ok,
      postsScanned,
      postsUpdated,
      imagesMigrated,
      errors,
      message: `Analisados ${postsScanned} artigo(s); ${postsUpdated} .md atualizado(s); ${imagesMigrated} imagem(ns) gravada(s) em public/assets/blog/.`,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...(auth.responseHeaders as object) },
    },
  );
};
