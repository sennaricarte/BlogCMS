import * as cheerio from "cheerio";

/**
 * Remove scripts, estilos, classes e atributos `data-*` / `on*` antes do Turndown.
 * Usado na importação de conteúdo externo (SEO / Markdown mais limpo).
 */
export function stripNoiseFromHtmlFragment(html: string): string {
  const trimmed = (html || "").trim();
  if (!trimmed) return "";
  const $ = cheerio.load(trimmed, { decodeEntities: true });
  $("script, style, noscript, link[rel='stylesheet'], template").remove();

  $("*").each((_, el) => {
    if (el.type !== "tag") return;
    const $el = $(el);
    $el.removeAttr("class").removeAttr("style");
    const attribs = "attribs" in el ? (el as { attribs: Record<string, string> }).attribs : undefined;
    if (!attribs) return;
    for (const key of Object.keys(attribs)) {
      if (key.startsWith("data-") || key.startsWith("on")) {
        $el.removeAttr(key);
      }
    }
  });

  return ($.root().html() || "").trim();
}
