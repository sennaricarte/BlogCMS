import type { APIRoute } from "astro";
import * as cheerio from "cheerio";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";
import {
  articleHtmlToMarkdown,
  extractArticleHtml,
  extractLikelyArticleLinks,
  extractMetaFromPage,
} from "../../../../lib/import-convert";

export const prerender = false;
const BATCH_LINK_LIMIT = 500;
const BATCH_FETCH_LIMIT = 20;
const MAX_BATCH_FETCH_LIMIT = 25;

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

function resolveMaybeAbsoluteUrl(raw: string | undefined, baseUrl: string): string | undefined {
  const v = (raw || "").trim();
  if (!v) return undefined;
  try {
    return new URL(v, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function extractMetaImageUrl(pageHtml: string, pageUrl: string): string | undefined {
  const $ = cheerio.load(pageHtml, { decodeEntities: true });
  const ogRaw = $('meta[property="og:image"]').attr("content")?.trim();
  if (ogRaw) return resolveMaybeAbsoluteUrl(ogRaw, pageUrl);
  const twRaw = $('meta[name="twitter:image"]').attr("content")?.trim();
  if (twRaw) return resolveMaybeAbsoluteUrl(twRaw, pageUrl);
  return undefined;
}

function extractFirstImageUrlFromHtml(fragmentHtml: string, baseUrl: string): string | undefined {
  const raw = fragmentHtml.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]?.trim();
  return resolveMaybeAbsoluteUrl(raw, baseUrl);
}

async function fetchHtml(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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

async function discoverLinksFromSitemap(baseUrl: string, limit = BATCH_LINK_LIMIT): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const sitemapIndexUrl = `${origin}/sitemap.xml`;
  const indexXml = await fetchText(sitemapIndexUrl);
  if (!indexXml) return [];

  const indexLocs = xmlLocs(indexXml);
  const likelyArticleSitemaps = indexLocs.filter(
    (u) => /type=articles|article|post|blog/i.test(u),
  );
  const targets = likelyArticleSitemaps.length > 0 ? likelyArticleSitemaps : indexLocs;

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

  let body: { articleUrl?: string; onlyArticles?: boolean; offset?: number; limit?: number };
  try {
    body = (await context.request.json()) as { articleUrl?: string; onlyArticles?: boolean; offset?: number; limit?: number };
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400, auth.responseHeaders);
  }

  const url = normalizeAbsoluteUrl(body.articleUrl || "");
  const onlyArticles = body.onlyArticles !== false;
  const offset = Math.max(0, Number.isFinite(body.offset) ? Number(body.offset) : 0);
  const limit = Math.min(
    MAX_BATCH_FETCH_LIMIT,
    Math.max(1, Number.isFinite(body.limit) ? Number(body.limit) : BATCH_FETCH_LIMIT),
  );
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
    const featuredImage =
      extractMetaImageUrl(html, res.url || url) || extractFirstImageUrlFromHtml(fragment, res.url || url);
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
            featuredImageUrl: featuredImage,
            sourceUrl: res.url || url,
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
  const pagedLinks = links.slice(offset, offset + limit);
  const hasMore = offset + pagedLinks.length < links.length;
  const nextOffset = offset + pagedLinks.length;
  if (links.length > 0 && pagedLinks.length === 0) {
    return json(
      {
        ok: true,
        posts: [],
        totalDiscovered: links.length,
        hasMore: false,
        nextOffset: links.length,
        message: "Não há mais lotes para carregar nesta origem.",
      },
      200,
      auth.responseHeaders,
    );
  }
  if (links.length > 0 && preferBatch) {
    return json(
      {
        ok: true,
        discoveredLinks: pagedLinks,
        totalDiscovered: links.length,
        hasMore,
        nextOffset,
        message:
          "Página inicial/listagem detectada. Escolha os links abaixo e clique em «Importar» em cada artigo.",
      },
      200,
      auth.responseHeaders,
    );
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
          sourceUrl: finalUrl,
        },
        message: "Conteúdo extraído em modo compatibilidade (renderização JavaScript).",
      },
      200,
      auth.responseHeaders,
    );
  }

  // Se não for listagem ou não conseguiu artigo claro, devolve links para importação individual.
  if (links.length === 0) {
    links = await discoverLinksFromSitemap(finalUrl, BATCH_LINK_LIMIT);
    if (onlyArticles) {
      links = links.filter(isLikelyArticleUrl);
    }
  }
  const fallbackPagedLinks = links.slice(offset, offset + limit);
  const fallbackHasMore = offset + fallbackPagedLinks.length < links.length;
  const fallbackNextOffset = offset + fallbackPagedLinks.length;
  if (links.length > 0 && fallbackPagedLinks.length === 0) {
    return json(
      {
        ok: true,
        posts: [],
        totalDiscovered: links.length,
        hasMore: false,
        nextOffset: links.length,
        message: "Não há mais lotes para carregar nesta origem.",
      },
      200,
      auth.responseHeaders,
    );
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

  return json(
    {
      ok: true,
      discoveredLinks: fallbackPagedLinks,
      totalDiscovered: links.length,
      hasMore: fallbackHasMore,
      nextOffset: fallbackNextOffset,
      message:
        "Encontramos links de conteúdo nesta página. Escolha um link específico e use «Importar» para extrair o artigo.",
    },
    200,
    auth.responseHeaders,
  );
};
