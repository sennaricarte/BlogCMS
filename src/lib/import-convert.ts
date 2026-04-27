import * as cheerio from "cheerio";
import { stripNoiseFromHtmlFragment } from "./import-html-clean";
import { htmlToMarkdown } from "./html-to-markdown";

/** Extrai HTML de `<article>` ou, em alternativa, `<main>`. */
export function extractArticleHtml(fullPageHtml: string): string | null {
  const $ = cheerio.load(fullPageHtml, { decodeEntities: true });
  let $node = $("article").first();
  if (!$node.length) $node = $("main").first();
  if (!$node.length) return null;
  const inner = $node.html();
  return inner?.trim() ? inner.trim() : null;
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
