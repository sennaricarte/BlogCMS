import { getCollection, type CollectionEntry } from "astro:content";

export const BLOG_PER_PAGE = 5;

/** URL pública do artigo (à raiz do site, sem prefixo `/blog`). */
export function blogPostHref(postId: string): string {
  return `/${postId}/`;
}

type BlogEntry = CollectionEntry<"blog">;

export function isVisiblePost(entry: BlogEntry, includeDrafts: boolean): boolean {
  if (import.meta.env.PROD) return !entry.data.draft;
  return includeDrafts || !entry.data.draft;
}

export async function getPublicBlogPosts(includeDraftsInDev = false): Promise<BlogEntry[]> {
  const all = await getCollection("blog", (e) => isVisiblePost(e, includeDraftsInDev));
  return all.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

export function paginate<T>(items: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

export function pageCount(totalItems: number, perPage: number): number {
  return Math.max(1, Math.ceil(totalItems / perPage));
}
