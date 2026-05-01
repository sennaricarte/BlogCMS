import { marked } from "marked";
import { normalizeLegacyBlogPostAnchorsInHtml, normalizeLegacyBlogPostMarkdownLinks } from "./blog-post-links";
import { rewriteHtmlImagesForAdminEditor } from "./admin-editor-image-urls";

/**
 * Converte Markdown (corpo de artigo) em HTML para carregar o editor (TipTap).
 * Sincronizado com o `marked` usado noutros scripts do admin.
 */
export function markdownToHtmlForEditor(markdown: string): string {
  const raw = normalizeLegacyBlogPostMarkdownLinks((markdown || "").trim());
  if (!raw) {
    return "<p></p>";
  }
  try {
    const html = String(marked.parse(raw));
    return normalizeLegacyBlogPostAnchorsInHtml(rewriteHtmlImagesForAdminEditor(html));
  } catch {
    return "<p></p>";
  }
}
