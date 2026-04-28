import * as cheerio from "cheerio";
import { stripNoiseFromHtmlFragment } from "./import-html-clean";
import { htmlToMarkdown } from "./html-to-markdown";

function scoreCandidateHtml(html: string): number {
  const text = stripHtmlToText(html);
  if (!text) return 0;
  const paragraphHits = (html.match(/<p[\s>]/gi) || []).length;
  const headingHits = (html.match(/<h[1-6][\s>]/gi) || []).length;
  return text.length + paragraphHits * 80 + headingHits * 40;
}

function stripHtmlToText(html: string): string {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai HTML do candidato mais provável de corpo (article/main/post-content). */
export function extractArticleHtml(fullPageHtml: string): string | null {
  const $ = cheerio.load(fullPageHtml, { decodeEntities: true });
  const selectors = [
    "article",
    "main",
    "[role='main']",
    ".post-content",
    ".entry-content",
    ".article-content",
    ".content article",
    ".single-post",
  ];

  let bestHtml = "";
  let bestScore = 0;
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const inner = ($(el).html() || "").trim();
      if (!inner) return;
      const score = scoreCandidateHtml(inner);
      if (score > bestScore) {
        bestScore = score;
        bestHtml = inner;
      }
    });
  }

  if (!bestHtml) return null;
  // Evita retornar "casca" com pouco conteúdo (menus, teaser, etc).
  if (stripHtmlToText(bestHtml).length < 220) return null;
  return bestHtml;
}

export function extractMetaFromPage(fullPageHtml: string): { title: string; description: string } {
  const $ = cheerio.load(fullPageHtml, { decodeEntities: true });
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const titleTag = $("title").first().text().trim();
  const h1 = $("h1").first().text().trim();
  const title = ogTitle || h1 || titleTag || "Artigo importado";

  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();
  const metaDesc = $('meta[name="description"]').attr("content")?.trim();
  const description = (ogDesc || metaDesc || title).slice(0, 160);

  return { title, description };
}

export function articleHtmlToMarkdown(html: string): string {
  const cleaned = stripNoiseFromHtmlFragment(html);
  return htmlToMarkdown(cleaned);
}

/** Tenta descobrir links de artigos numa página de listagem/home. */
export function extractLikelyArticleLinks(fullPageHtml: string, baseUrl: string, limit = 12): string[] {
  const $ = cheerio.load(fullPageHtml, { decodeEntities: true });
  const base = new URL(baseUrl);
  const out = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href) return;

    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }

    if (abs.origin !== base.origin) return;
    abs.hash = "";
    abs.search = "";

    const path = abs.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return;

    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return;

    // Heurística para evitar páginas de navegação/arquivo.
    const banPrefix = new Set([
      "tag",
      "tags",
      "categoria",
      "categorias",
      "category",
      "author",
      "authors",
      "sobre",
      "about",
      "contato",
      "contact",
      "admin",
      "login",
      "wp-admin",
      "wp-content",
      "search",
      "busca",
      "page",
      "pages",
      "p",
    ]);
    if (banPrefix.has(segments[0]?.toLowerCase() || "")) return;

    if (/\.(xml|json|pdf|png|jpe?g|webp|gif|svg|zip|rar)$/i.test(path)) return;
    out.add(`${abs.origin}${path}`);
  });

  return Array.from(out).slice(0, limit);
}
