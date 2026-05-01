import { marked } from "marked";
import { normalizeLegacyBlogPostAnchorsInHtml, normalizeLegacyBlogPostMarkdownLinks } from "./blog-post-links";
import {
  rewriteHtmlImagesForAdminEditor,
  type EditorImagePreviewContext,
} from "./admin-editor-image-urls";

/**
 * Converte Markdown (corpo de artigo) em HTML para carregar o editor (TipTap).
 * Sincronizado com o `marked` usado noutros scripts do admin.
 */
export function markdownToHtmlForEditor(
  markdown: string,
  imagePreviewContext?: EditorImagePreviewContext | null,
): string {
  const raw = normalizeLegacyBlogPostMarkdownLinks((markdown || "").trim());
  if (!raw) {
    return "<p></p>";
  }
  try {
    const html = String(marked.parse(raw));
    return normalizeLegacyBlogPostAnchorsInHtml(rewriteHtmlImagesForAdminEditor(html, imagePreviewContext));
  } catch {
    return "<p></p>";
  }
}
