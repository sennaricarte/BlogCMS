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
  // Remove blocos de navegação/breadcrumb que às vezes vêm junto no topo do artigo importado.
  $(
    [
      "nav",
      "header",
      "footer",
      ".breadcrumb",
      ".breadcrumbs",
      "[class*='breadcrumb']",
      "[id*='breadcrumb']",
      "[aria-label*='breadcrumb' i]",
      "[aria-label*='migalha' i]",
      "[role='navigation']",
    ].join(","),
  ).remove();

  // Remove listas típicas de trilha de navegação.
  $("ol, ul").each((_, el) => {
    const $el = $(el);
    const txt = $el.text().replace(/\s+/g, " ").trim().toLowerCase();
    if (!txt) return;
    if (txt.includes("início") || txt.includes("inicio") || txt.includes("home")) {
      const links = $el.find("a").length;
      const plainLen = txt.length;
      if (links >= 2 && plainLen <= 220) {
        $el.remove();
      }
    }
  });

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
