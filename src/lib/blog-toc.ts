import GithubSlugger from "github-slugger";

export type TocItem = { depth: 2 | 3; text: string; id: string };

/** Remove formatação Markdown inline para o texto visível do sumário. */
function stripInlineMarkdown(raw: string): string {
  let t = raw.trim();
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/\*([^*]+)\*/g, "$1");
  return t.trim();
}

/**
 * Extrai `##` e `###` do corpo Markdown (fora de blocos de código),
 * com `id` alinhado ao gerado pelo Astro (github-slugger).
 */
export function extractTocFromMarkdown(markdown: string): TocItem[] {
  if (!markdown?.trim()) return [];

  const lines = markdown.split(/\r?\n/);
  const toc: TocItem[] = [];
  let inFence = false;
  const slugger = new GithubSlugger();

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h2 = trimmed.match(/^##\s+(.+?)\s*$/);
    const h3 = trimmed.match(/^###\s+(.+?)\s*$/);
    const raw = h2?.[1] ?? h3?.[1];
    if (!raw) continue;
    if (/^#/.test(raw)) continue;

    const depth = h2 ? 2 : 3;
    const text = stripInlineMarkdown(raw);
    if (!text) continue;
    const id = slugger.slug(text);
    if (!id) continue;
    toc.push({ depth, text, id });
  }

  return toc;
}
