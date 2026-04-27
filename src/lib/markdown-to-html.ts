import { marked } from "marked";

/**
 * Converte Markdown (corpo de artigo) em HTML para carregar o editor (TipTap).
 * Sincronizado com o `marked` usado noutros scripts do admin.
 */
export function markdownToHtmlForEditor(markdown: string): string {
  const raw = (markdown || "").trim();
  if (!raw) {
    return "<p></p>";
  }
  try {
    return String(marked.parse(raw));
  } catch {
    return "<p></p>";
  }
}
