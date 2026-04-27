import taxonomies from "../data/taxonomies.json";
import { slugifyText } from "./slugify";
import type { CollectionEntry } from "astro:content";

type BlogEntry = CollectionEntry<"blog">;

export type TaxonomyItem = {
  slug: string;
  name: string;
  description: string;
};

export type TaxonomiesData = {
  categories: TaxonomyItem[];
  tags: TaxonomyItem[];
};

export const taxonomiesData = taxonomies as TaxonomiesData;

export function getCategoryBySlug(slug: string | undefined | null): TaxonomyItem | undefined {
  if (!slug) return undefined;
  const s = slug.trim().toLowerCase();
  return taxonomiesData.categories.find((c) => c.slug === s);
}

export function getTagBySlug(slug: string | undefined | null): TaxonomyItem | undefined {
  if (!slug) return undefined;
  const s = slug.trim().toLowerCase();
  return taxonomiesData.tags.find((t) => t.slug === s);
}

/** Normaliza qualquer string de tag do frontmatter para o slug (compatível com nomes legados). */
export function tagToSlug(value: string): string {
  return slugifyText(value, "tag");
}

/**
 * Lê a etiqueta a apresentar: nome na taxonomia se existir, senão o valor original.
 */
export function getTagDisplayName(raw: string): string {
  const slug = tagToSlug(raw);
  const t = getTagBySlug(slug);
  if (t) return t.name;
  return raw;
}

export function getCategoryDisplayName(raw: string | undefined | null): string {
  if (!raw?.trim()) return "";
  const c = getCategoryBySlug(raw);
  if (c) return c.name;
  return raw;
}

export function postHasTagSlug(entry: BlogEntry, tagSlug: string): boolean {
  const want = tagSlug.toLowerCase();
  for (const t of entry.data.tags) {
    if (tagToSlug(t) === want || String(t).toLowerCase() === want) return true;
  }
  return false;
}

export function getPostsForTagSlug(
  posts: BlogEntry[],
  tagSlug: string,
): BlogEntry[] {
  return posts.filter((p) => postHasTagSlug(p, tagSlug));
}

export function getPostsForCategorySlug(
  posts: BlogEntry[],
  categorySlug: string,
): BlogEntry[] {
  const c = categorySlug.toLowerCase();
  return posts.filter(
    (p) => p.data.category && String(p.data.category).trim().toLowerCase() === c,
  );
}

/**
 * Coleta slugs de etiqueta que têm pelo menos um artigo publicado (após `slug` normalizado).
 */
export function getTagSlugsWithPosts(posts: BlogEntry[]): string[] {
  const set = new Set<string>();
  for (const p of posts) {
    for (const t of p.data.tags) {
      set.add(tagToSlug(t));
    }
  }
  return Array.from(set).sort();
}

/**
 * Categorias que têm pelo menos um post.
 */
export function getCategorySlugsWithPosts(posts: BlogEntry[]): string[] {
  const set = new Set<string>();
  for (const p of posts) {
    if (p.data.category?.trim()) {
      set.add(p.data.category.trim().toLowerCase());
    }
  }
  return Array.from(set).sort();
}
