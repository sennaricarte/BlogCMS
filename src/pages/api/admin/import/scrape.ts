import type { APIRoute } from "astro";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";
import {
  articleHtmlToMarkdown,
  extractArticleHtml,
  extractLikelyArticleLinks,
  extractMetaFromPage,
} from "../../../../lib/import-convert";

export const prerender = false;
const BATCH_LINK_LIMIT = 30;
const BATCH_FETCH_LIMIT = 20;

function json(o: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(headers as object) },
  });
}

function normalizeAbsoluteUrl(input: string): string {
  let v = input.trim();
  if (!v) return "";
  v = v.replace(/^([a-z]+);\/\//i, "$1://");
  if (!/^https?:\/\//i.test(v)) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

function slugFromUrl(url: string): string {
  const parsed = new URL(url);
  const last = parsed.pathname
    .split("/")
    .filter(Boolean)
    .pop();
  const base = (last || "import")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || `import-${Date.now()}`;
}

function isLikelyListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const p = (u.pathname || "/").toLowerCase().replace(/\/+$/, "") || "/";
    if (p === "/") return true;
    if (["/blog", "/posts", "/noticias", "/news", "/artigos", "/articles"].includes(p)) return true;
    if (/\/(categoria|category|tag|tags)\//.test(p)) return true;
    return false;
  } catch {
    return false;
  }
}

function isLikelyArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = (u.pathname || "/").toLowerCase().replace(/\/+$/, "");
    if (!path || path === "/") return false;
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return false;
    const first = segments[0] || "";
    const blockedRoots = new Set([
      "sobre",
      "about",
      "contato",
      "contact",
      "politica-de-privacidade",
      "privacy-policy",
      "termos",
      "terms",
      "categorias",
      "categoria",
      "category",
      "tags",
      "tag",
      "search",
      "busca",
      "admin",
      "login",
      "blog",
      "posts",
      "noticias",
      "news",
      "artigos",
      "articles",
      "p",
      "page",
      "pages",
    ]);
    if (blockedRoots.has(first)) return false;
    const full = segments.join("/");
    const blockedTokens = [
      "sobre",
      "about",
      "contato",
      "contact",
      "termos",
      "terms",
      "politica-de-privacidade",
      "privacy-policy",
      "glossario",
      "glossary",
      "colunistas",
      "parceria",
      "quem-somos",
      "institutional",
    ];
    if (blockedTokens.some((token) => full.includes(token))) return false;
    if (/\.(xml|json|pdf|png|jpe?g|gif|webp|svg|zip|rar)$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchHtml(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "BlogCMS-Import/1.0 (+https://github.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: {
        Accept: "application/xml,text/xml,text/plain,text/html",
        "User-Agent": "BlogCMS-Import/1.0 (+https://github.com)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function xmlLocs(xml: string): string[] {
  const out = new Set<string>();
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const u = (m[1] || "").trim();
    if (u) out.add(u);
  }
  return Array.from(out);
}

type ReaderExtract = {
  title: string;
  description: string;
  markdown: string;
  pubDate: string;
};

function normalizeImportedMarkdown(md: string): string {
  const base = (md || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!base) return "";
  return base
    .replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2")
    .replace(/([^\n])\n(\d+\.\s)/g, "$1\n\n$2")
    .replace(/([^\n])\n(-\s)/g, "$1\n\n$2")
    .replace(/([^\n])\n(\|.+\|)/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownTextLength(md: string): number {
  return (md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, " ")
    .replace(/[#>*_|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

function isSubstantialMarkdown(md: string): boolean {
  return markdownTextLength(md) >= 260;
}

async function extractViaReader(url: string): Promise<ReaderExtract | null> {
  const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "").replace(/^\/+/, "")}`;
  const text = await fetchText(readerUrl);
  if (!text) return null;

  const mdIdx = text.indexOf("Markdown Content:");
  if (mdIdx < 0) return null;
  const markdown = normalizeImportedMarkdown(text.slice(mdIdx + "Markdown Content:".length));
  if (!markdown) return null;

  const title =
    text.match(/^Title:\s*(.+)$/im)?.[1]?.trim() ||
    markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    "Artigo importado";

  const rawPub = text.match(/^Published Time:\s*(.+)$/im)?.[1]?.trim();
  const pubDate = (() => {
    if (!rawPub) return new Date().toISOString().slice(0, 10);
    const d = new Date(rawPub);
    return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
  })();

  // Usa o primeiro parágrafo útil como descrição.
  const descLine = markdown
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("![](") && !l.startsWith("["));
  const description = (descLine || title).slice(0, 160);

  return { title, description, markdown, pubDate };
}

async function discoverLinksFromSitemap(baseUrl: string, limit = 16): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const sitemapIndexUrl = `${origin}/sitemap.xml`;
  const indexXml = await fetchText(sitemapIndexUrl);
  if (!indexXml) return [];

  const indexLocs = xmlLocs(indexXml);
  const likelyArticleSitemaps = indexLocs.filter(
    (u) => /type=articles|article|post|blog/i.test(u),
  );
  const targets = (likelyArticleSitemaps.length > 0 ? likelyArticleSitemaps : indexLocs).slice(0, 8);

  const articleUrls = new Set<string>();
  for (const smUrl of targets) {
    const xml = await fetchText(smUrl);
    if (!xml) continue;
    for (const loc of xmlLocs(xml)) {
      try {
        const u = new URL(loc);
        if (u.origin !== origin) continue;
        const path = u.pathname.replace(/\/+$/, "");
        if (!path || path === "/") continue;
        if (/\.(xml|json|png|jpe?g|webp|gif|svg|pdf)$/i.test(path)) continue;
        articleUrls.add(`${u.origin}${path}`);
        if (articleUrls.size >= limit) return Array.from(articleUrls);
      } catch {
        // ignora entradas inválidas
      }
    }
  }
  return Array.from(articleUrls).slice(0, limit);
}

export const POST: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) {
    return json({ ok: false, error: "Sessão em falta." }, 401, auth.responseHeaders);
  }

  let body: { articleUrl?: string; onlyArticles?: boolean };
  try {
    body = (await context.request.json()) as { articleUrl?: string; onlyArticles?: boolean };
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400, auth.responseHeaders);
  }

  const url = normalizeAbsoluteUrl(body.articleUrl || "");
  const onlyArticles = body.onlyArticles !== false;
  if (!url) {
    return json({ ok: false, error: "Indica uma URL absoluta (https://…)." }, 400, auth.responseHeaders);
  }

  let res: Response;
  try {
    res = await fetchHtml(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro de rede.";
    return json({ ok: false, error: msg }, 502, auth.responseHeaders);
  }

  if (!res.ok) {
    return json({ ok: false, error: `O servidor devolveu HTTP ${res.status}.` }, 502, auth.responseHeaders);
  }

  const html = await res.text();
  const fragment = extractArticleHtml(html);
  if (fragment) {
    const meta = extractMetaFromPage(html);
    const markdown = normalizeImportedMarkdown(articleHtmlToMarkdown(fragment));
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim();
    if (isSubstantialMarkdown(markdown)) {
      return json(
        {
          ok: true,
          post: {
            slug: slugFromUrl(url),
            title: meta.title,
            description: meta.description.slice(0, 160),
            pubDate: new Date().toISOString().slice(0, 10),
            markdown,
            featuredImageUrl: ogImage,
          },
        },
        200,
        auth.responseHeaders,
      );
    }
  }

  const finalUrl = res.url || url;
  const preferBatch = isLikelyListingUrl(finalUrl);

  // Para home/listagem, tenta primeiro descobrir links de artigos e importar em lote.
  const linksFromPage = extractLikelyArticleLinks(html, finalUrl, BATCH_LINK_LIMIT);
  const linksFromSitemap = await discoverLinksFromSitemap(finalUrl, BATCH_LINK_LIMIT);
  let links = [...linksFromSitemap, ...linksFromPage];
  links = Array.from(new Set(links));
  if (onlyArticles) {
    links = links.filter(isLikelyArticleUrl);
  }
  if (links.length > 0 && preferBatch) {
    const candidates = await Promise.allSettled(
      links.slice(0, BATCH_FETCH_LIMIT).map(async (link) => {
        const pageRes = await fetchHtml(link);
        if (!pageRes.ok) return null;
        const pageHtml = await pageRes.text();
        const article = extractArticleHtml(pageHtml);
        if (!article) {
          const reader = await extractViaReader(link);
          if (!reader) return null;
          return {
            slug: slugFromUrl(link),
            title: reader.title,
            description: reader.description,
            pubDate: reader.pubDate,
            markdown: reader.markdown,
            featuredImageUrl: undefined,
          };
        }
        const meta = extractMetaFromPage(pageHtml);
        const ogImage = pageHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim();
        const markdown = normalizeImportedMarkdown(articleHtmlToMarkdown(article));
        if (!isSubstantialMarkdown(markdown)) {
          const reader = await extractViaReader(link);
          if (!reader) return null;
          return {
            slug: slugFromUrl(link),
            title: reader.title,
            description: reader.description,
            pubDate: reader.pubDate,
            markdown: reader.markdown,
            featuredImageUrl: ogImage,
          };
        }
        return {
          slug: slugFromUrl(link),
          title: meta.title,
          description: meta.description.slice(0, 160),
          pubDate: new Date().toISOString().slice(0, 10),
          markdown,
          featuredImageUrl: ogImage,
        };
      }),
    );

    const posts: Array<{
      slug: string;
      title: string;
      description: string;
      pubDate: string;
      markdown: string;
      featuredImageUrl?: string;
    }> = [];
    for (const result of candidates) {
      if (result.status === "fulfilled" && result.value) {
        posts.push(result.value);
      }
    }
    if (posts.length > 0) {
      return json(
        {
          ok: true,
          posts,
          message: `Página de listagem detectada. ${posts.length} artigo(s) foram extraído(s) automaticamente.`,
        },
        200,
        auth.responseHeaders,
      );
    }
  }

  // Fallback para páginas que renderizam conteúdo via JS (SPA): leitor remoto (URL única).
  const readerSingle = await extractViaReader(finalUrl);
  if (readerSingle) {
    return json(
      {
        ok: true,
        post: {
          slug: slugFromUrl(finalUrl),
          title: readerSingle.title,
          description: readerSingle.description,
          pubDate: readerSingle.pubDate,
          markdown: readerSingle.markdown,
        },
        message: "Conteúdo extraído em modo compatibilidade (renderização JavaScript).",
      },
      200,
      auth.responseHeaders,
    );
  }

  // Se não for listagem ou não conseguiu em lote antes, tenta lote agora.
  if (links.length === 0) {
    links = await discoverLinksFromSitemap(finalUrl, BATCH_LINK_LIMIT);
    if (onlyArticles) {
      links = links.filter(isLikelyArticleUrl);
    }
  }
  if (links.length === 0) {
    return json(
      {
        ok: false,
        error:
          "Não foi encontrado conteúdo em <article>/<main>, links claros de artigos na página, nem URLs de posts no sitemap.",
      },
      422,
      auth.responseHeaders,
    );
  }

  const candidates = await Promise.allSettled(
    links.slice(0, BATCH_FETCH_LIMIT).map(async (link) => {
      const pageRes = await fetchHtml(link);
      if (!pageRes.ok) return null;
      const pageHtml = await pageRes.text();
      const article = extractArticleHtml(pageHtml);
      if (!article) {
        const reader = await extractViaReader(link);
        if (!reader) return null;
        return {
          slug: slugFromUrl(link),
          title: reader.title,
          description: reader.description,
          pubDate: reader.pubDate,
          markdown: reader.markdown,
          featuredImageUrl: undefined,
        };
      }
      const meta = extractMetaFromPage(pageHtml);
      const ogImage = pageHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim();
      const markdown = normalizeImportedMarkdown(articleHtmlToMarkdown(article));
      if (!isSubstantialMarkdown(markdown)) {
        const reader = await extractViaReader(link);
        if (!reader) return null;
        return {
          slug: slugFromUrl(link),
          title: reader.title,
          description: reader.description,
          pubDate: reader.pubDate,
          markdown: reader.markdown,
          featuredImageUrl: ogImage,
        };
      }
      return {
        slug: slugFromUrl(link),
        title: meta.title,
        description: meta.description.slice(0, 160),
        pubDate: new Date().toISOString().slice(0, 10),
        markdown,
        featuredImageUrl: ogImage,
      };
    }),
  );

  const posts: Array<{
    slug: string;
    title: string;
    description: string;
    pubDate: string;
    markdown: string;
    featuredImageUrl?: string;
  }> = [];
  for (const result of candidates) {
    if (result.status === "fulfilled" && result.value) {
      posts.push(result.value);
    }
  }

  if (posts.length === 0) {
    return json(
      {
        ok: false,
        error: "Encontramos links na página, mas não conseguimos extrair artigos. Tenta colar a URL de um post específico.",
      },
      422,
      auth.responseHeaders,
    );
  }

  return json(
    {
      ok: true,
      posts,
      message: `Página de listagem detectada. ${posts.length} artigo(s) foram extraído(s) automaticamente.`,
    },
    200,
    auth.responseHeaders,
  );
};
