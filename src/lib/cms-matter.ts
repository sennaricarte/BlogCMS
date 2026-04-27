import matter from "gray-matter";
import type { PageBlock } from "./page-blocks.zod";

/** Dados de frontmatter alinhados com a coleção `blog` (antes de `image()` no build). */
export type BlogFrontmatterInput = {
  title: string;
  description: string;
  /** Título exibido em resultados de busca; opcional. */
  seoTitle?: string;
  /** Palavra-chave alvo; opcional. */
  seoFocusKeyword?: string;
  pubDate: string;
  updatedDate?: string;
  author: string;
  heroImage: string;
  tags: string[];
  category?: string;
  draft: boolean;
  /** Agendado para publicação automática (com `draft: true` e data futura). */
  scheduled?: boolean;
};

export function serializeBlogMarkdown(body: string, data: BlogFrontmatterInput): string {
  const dates: Record<string, string> = {
    pubDate: data.pubDate,
  };
  if (data.updatedDate) dates.updatedDate = data.updatedDate;

  const fm: Record<string, unknown> = {
    title: data.title,
    description: data.description,
    ...dates,
    author: data.author,
    heroImage: data.heroImage,
    tags: data.tags,
    draft: data.draft,
  };
  if (data.seoTitle?.trim()) {
    fm.seoTitle = data.seoTitle.trim();
  }
  if (data.seoFocusKeyword?.trim()) {
    fm.seoFocusKeyword = data.seoFocusKeyword.trim();
  }
  if (data.category?.trim()) {
    fm.category = data.category.trim();
  }
  if (data.scheduled) {
    fm.scheduled = true;
  }

  return matter.stringify(typeof body === "string" ? body : String(body), fm).replace(/\n{3,}/g, "\n\n");
}

export type PageFrontmatterInput = {
  title: string;
  description: string;
  pubDate: string;
  updatedDate?: string;
  draft: boolean;
  pageBlocks?: PageBlock[];
};

export function serializePageMarkdown(body: string, data: PageFrontmatterInput): string {
  const fm: Record<string, unknown> = {
    title: data.title,
    description: data.description,
    pubDate: data.pubDate,
    draft: data.draft,
  };
  if (data.updatedDate) fm.updatedDate = data.updatedDate;
  if (data.pageBlocks && data.pageBlocks.length > 0) {
    fm.pageBlocks = data.pageBlocks;
  }
  return matter.stringify(body, fm).replace(/\n{3,}/g, "\n\n");
}

export function parseMarkdownFile(raw: string) {
  return matter(raw);
}
