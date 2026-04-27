/** Resposta mínima de `wp/v2/posts` com `_embed` (campos SEO variam com plugins). */
export type WpRestPost = {
  id: number;
  slug: string;
  date: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt?: { rendered: string };
  /** Yoast SEO (REST): objeto com `description`, `og_description`, etc. */
  yoast_head_json?: Record<string, unknown>;
  /** Yoast: HTML do `<head>` (fallback para `<meta name="description">`). */
  yoast_head?: string;
  /** Rank Math: descrição SEO quando exposta na raiz do post. */
  rank_math_description?: string;
  /** Metadados expostos na REST (`show_in_rest`), ex.: Yoast / Rank Math. */
  meta?: Record<string, unknown>;
  _embedded?: {
    "wp:featuredmedia"?: Array<{
      source_url?: string;
    }>;
  };
};

function toPlainMetaString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") {
    const t = v[0].trim();
    return t.length ? t : undefined;
  }
  return undefined;
}

function metaLookup(meta: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!meta) return undefined;
  for (const k of keys) {
    const v = toPlainMetaString(meta[k]);
    if (v) return v;
  }
  return undefined;
}

function descriptionFromYoastHeadHtml(html: string): string | undefined {
  if (!html.includes("description")) return undefined;
  const a = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  if (a?.[1]) return a[1].trim() || undefined;
  const b = html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  if (b?.[1]) return b[1].trim() || undefined;
  return undefined;
}

/**
 * Meta description para o nosso `description` (SERP), priorizando Yoast e Rank Math na REST.
 */
export function resolveWpImportDescription(
  post: WpRestPost,
  excerptHtml: string,
  bodyHtml: string,
  titleFallback: string,
): string {
  const yj = post.yoast_head_json;
  let fromPlugins: string | undefined;
  if (yj && typeof yj === "object") {
    fromPlugins =
      toPlainMetaString(yj.description) ??
      toPlainMetaString(yj.og_description) ??
      toPlainMetaString((yj as { open_graph?: { description?: string } }).open_graph?.description) ??
      toPlainMetaString(yj.twitter_description);
  }
  if (!fromPlugins && typeof post.yoast_head === "string" && post.yoast_head) {
    fromPlugins = descriptionFromYoastHeadHtml(post.yoast_head);
  }
  const meta = post.meta;
  if (!fromPlugins) {
    fromPlugins =
      metaLookup(meta, "_yoast_wpseo_metadesc") ??
      toPlainMetaString(post.rank_math_description) ??
      metaLookup(meta, "rank_math_description");
  }
  if (fromPlugins) {
    const t = stripHtmlToText(fromPlugins, 160).trim();
    if (t) return t;
  }
  return stripHtmlToText(excerptHtml || bodyHtml, 160) || titleFallback.slice(0, 160);
}

export function normalizeWpSiteUrl(input: string): string {
  let u = input.trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, "");
}

export function stripHtmlToText(html: string, maxLen: number): string {
  const t = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}
